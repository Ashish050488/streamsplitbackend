const jwt = require('jsonwebtoken');
const ChatMessage = require('../models/ChatMessage');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');

module.exports = function chatSocketHandler(io) {
  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.sub).select('_id name phone avatar_url');
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`💬 ${socket.user.name || socket.user.phone} connected`);

    // Join a group room
    socket.on('join_group', async (groupId) => {
      try {
        const membership = await GroupMembership.findOne({
          group_id: groupId, user_id: socket.user._id,
        });
        if (!membership) {
          return socket.emit('error', { message: 'Not a member of this group' });
        }
        socket.join(`group:${groupId}`);

        // Send last 50 messages
        const messages = await ChatMessage.find({ group_id: groupId, is_deleted: false })
          .populate('sender_id', 'name avatar_url phone')
          .sort({ createdAt: -1 }).limit(50);
        socket.emit('message_history', messages.reverse());
      } catch (err) {
        socket.emit('error', { message: 'Failed to join group' });
      }
    });

    // Leave group room
    socket.on('leave_group', (groupId) => {
      socket.leave(`group:${groupId}`);
    });

    // Send message
    socket.on('send_message', async ({ group_id, content, type = 'text', media_url }) => {
      try {
        if (!content || !content.trim()) return;

        const membership = await GroupMembership.findOne({
          group_id, user_id: socket.user._id,
        });
        if (!membership) return socket.emit('error', { message: 'Not a member' });
        if (membership.is_muted) return socket.emit('error', { message: 'You are muted in this group' });

        const msg = await ChatMessage.create({
          group_id, sender_id: socket.user._id,
          type, content: content.trim(), media_url,
        });

        const populated = await ChatMessage.findById(msg._id)
          .populate('sender_id', 'name avatar_url phone');

        io.to(`group:${group_id}`).emit('new_message', populated);
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', ({ group_id }) => {
      socket.to(`group:${group_id}`).emit('user_typing', {
        user_id: socket.user._id,
        name: socket.user.name || socket.user.phone,
      });
    });

    socket.on('disconnect', () => {
      console.log(`👋 ${socket.user.name || socket.user.phone} disconnected`);
    });
  });
};
