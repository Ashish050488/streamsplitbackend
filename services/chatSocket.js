const jwt = require('jsonwebtoken');
const ChatMessage = require('../models/ChatMessage');
const ChatRoom = require('../models/ChatRoom');
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

    // ─── Join a room (group or DM) by roomId ──────────────
    socket.on('join_room', async (roomId) => {
      try {
        const room = await ChatRoom.findById(roomId);
        if (!room) return socket.emit('error', { message: 'Room not found' });

        // Permission check
        if (room.type === 'dm') {
          if (!room.participants.some(p => p.toString() === socket.user._id.toString())) {
            return socket.emit('error', { message: 'Not a participant' });
          }
        } else if (room.type === 'group') {
          const membership = await GroupMembership.findOne({
            group_id: room.group_id, user_id: socket.user._id,
          });
          if (!membership) return socket.emit('error', { message: 'Not a member of this group' });
        }

        socket.join(`room:${roomId}`);

        // Send last 50 messages
        const messages = await ChatMessage.find({ room_id: roomId, is_deleted: false })
          .populate('sender_id', 'name avatar_url phone')
          .sort({ createdAt: -1 }).limit(50);
        socket.emit('message_history', messages.reverse());
      } catch (err) {
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // ─── Legacy: Join group room by groupId ───────────────
    socket.on('join_group', async (groupId) => {
      try {
        const membership = await GroupMembership.findOne({
          group_id: groupId, user_id: socket.user._id,
        });
        if (!membership) return socket.emit('error', { message: 'Not a member of this group' });

        // Find or create room
        let room = await ChatRoom.findOne({ type: 'group', group_id: groupId });
        if (!room) {
          room = await ChatRoom.create({ type: 'group', group_id: groupId, participants: [] });
        }

        socket.join(`room:${room._id}`);

        // Send last 50 messages (try room_id first, fall back to group_id)
        let messages = await ChatMessage.find({ room_id: room._id, is_deleted: false })
          .populate('sender_id', 'name avatar_url phone')
          .sort({ createdAt: -1 }).limit(50);

        if (messages.length === 0) {
          // Fallback: load old group_id-based messages
          messages = await ChatMessage.find({ group_id: groupId, is_deleted: false })
            .populate('sender_id', 'name avatar_url phone')
            .sort({ createdAt: -1 }).limit(50);
        }

        socket.emit('message_history', messages.reverse());
        // Also emit room info so frontend can track room_id
        socket.emit('room_info', { room_id: room._id, type: 'group', group_id: groupId });
      } catch (err) {
        socket.emit('error', { message: 'Failed to join group' });
      }
    });

    // ─── Leave room ──────────────────────────────────────
    socket.on('leave_room', (roomId) => {
      socket.leave(`room:${roomId}`);
    });

    socket.on('leave_group', (groupId) => {
      // Legacy — find room and leave
      ChatRoom.findOne({ type: 'group', group_id: groupId }).then(room => {
        if (room) socket.leave(`room:${room._id}`);
      });
    });

    // ─── Send message (via roomId) ───────────────────────
    socket.on('send_message', async ({ room_id, group_id, content, message, type = 'text', media_url }) => {
      try {
        const text = (content || message || '').trim();
        if (!text) return;

        let room;
        if (room_id) {
          room = await ChatRoom.findById(room_id);
        } else if (group_id) {
          // Legacy: find room by group_id
          room = await ChatRoom.findOne({ type: 'group', group_id });
          if (!room) room = await ChatRoom.create({ type: 'group', group_id, participants: [] });
        }

        if (!room) return socket.emit('error', { message: 'Room not found' });

        // Permission check
        if (room.type === 'dm') {
          if (!room.participants.some(p => p.toString() === socket.user._id.toString())) {
            return socket.emit('error', { message: 'Not a participant' });
          }
        } else if (room.type === 'group') {
          const membership = await GroupMembership.findOne({
            group_id: room.group_id, user_id: socket.user._id,
          });
          if (!membership) return socket.emit('error', { message: 'Not a member' });
          if (membership.is_muted) return socket.emit('error', { message: 'You are muted in this group' });
        }

        const msg = await ChatMessage.create({
          room_id: room._id,
          group_id: room.group_id || null,
          sender_id: socket.user._id,
          type, content: text, media_url,
        });

        // Update room metadata
        await ChatRoom.findByIdAndUpdate(room._id, {
          last_message_at: msg.createdAt,
          last_message_preview: text.substring(0, 80),
        });

        const populated = await ChatMessage.findById(msg._id)
          .populate('sender_id', 'name avatar_url phone');

        io.to(`room:${room._id}`).emit('new_message', populated);
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── Typing indicator ────────────────────────────────
    socket.on('typing', ({ room_id, group_id }) => {
      const target = room_id || group_id;
      if (room_id) {
        socket.to(`room:${room_id}`).emit('user_typing', {
          user_id: socket.user._id,
          name: socket.user.name || socket.user.phone,
        });
      } else if (group_id) {
        // Legacy: find room
        ChatRoom.findOne({ type: 'group', group_id }).then(room => {
          if (room) {
            socket.to(`room:${room._id}`).emit('user_typing', {
              user_id: socket.user._id,
              name: socket.user.name || socket.user.phone,
            });
          }
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`👋 ${socket.user.name || socket.user.phone} disconnected`);
    });
  });
};
