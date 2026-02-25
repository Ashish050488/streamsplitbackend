const router = require('express').Router();
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');
const Friendship = require('../models/Friendship');
const GroupMembership = require('../models/GroupMembership');
const { authenticate } = require('../middleware/auth');

function sortedPair(a, b) {
    return a.toString() < b.toString() ? [a, b] : [b, a];
}

// ─── GET /chat/rooms — List user's chat rooms ───────────────
router.get('/rooms', authenticate, async (req, res, next) => {
    try {
        const uid = req.user._id;

        // Get group rooms (user is member of)
        const memberships = await GroupMembership.find({ user_id: uid }).select('group_id');
        const groupIds = memberships.map(m => m.group_id);

        // Auto-create group rooms if they don't exist
        for (const gid of groupIds) {
            await ChatRoom.findOneAndUpdate(
                { type: 'group', group_id: gid },
                { $setOnInsert: { type: 'group', group_id: gid, participants: [] } },
                { upsert: true }
            );
        }

        const groupRooms = await ChatRoom.find({ type: 'group', group_id: { $in: groupIds } })
            .populate({ path: 'group_id', select: 'name member_count share_limit brand_id', populate: { path: 'brand_id', select: 'name logo_url slug' } })
            .sort({ last_message_at: -1, createdAt: -1 });

        // Get DM rooms
        const dmRooms = await ChatRoom.find({ type: 'dm', participants: uid })
            .populate('participants', 'name phone avatar_url')
            .sort({ last_message_at: -1, createdAt: -1 });

        const formatGroupRooms = groupRooms.map(r => ({
            _id: r._id,
            type: 'group',
            group: r.group_id ? {
                _id: r.group_id._id,
                name: r.group_id.name,
                member_count: r.group_id.member_count,
                share_limit: r.group_id.share_limit,
                brand: r.group_id.brand_id,
            } : null,
            last_message_at: r.last_message_at,
            last_message_preview: r.last_message_preview,
        }));

        const formatDmRooms = dmRooms.map(r => {
            const other = r.participants.find(p => p._id.toString() !== uid.toString());
            return {
                _id: r._id,
                type: 'dm',
                other_user: other ? { _id: other._id, name: other.name } : null,
                last_message_at: r.last_message_at,
                last_message_preview: r.last_message_preview,
            };
        });

        res.json({ success: true, data: { groups: formatGroupRooms, dms: formatDmRooms } });
    } catch (err) { next(err); }
});

// ─── POST /chat/dm/start — Create or get DM room ───────────
router.post('/dm/start', authenticate, async (req, res, next) => {
    try {
        const uid = req.user._id;
        const { user_id } = req.body;

        if (!user_id) return res.status(400).json({ success: false, message: 'user_id required' });
        if (user_id === uid.toString()) return res.status(400).json({ success: false, message: 'Cannot DM yourself' });

        // Check friendship
        const [a, b] = sortedPair(uid, user_id);
        const friendship = await Friendship.findOne({ user_a: a, user_b: b });
        if (!friendship) {
            return res.status(403).json({ success: false, message: 'Must be friends to start a DM' });
        }

        // Find or create DM room (participants sorted for consistent lookup)
        const participants = [a, b];
        let room = await ChatRoom.findOne({ type: 'dm', participants: { $all: participants, $size: 2 } });

        if (!room) {
            room = await ChatRoom.create({ type: 'dm', participants });
        }

        res.json({ success: true, data: { room_id: room._id } });
    } catch (err) { next(err); }
});

// ─── GET /chat/rooms/:roomId/messages — Paginated messages ──
router.get('/rooms/:roomId/messages', authenticate, async (req, res, next) => {
    try {
        const uid = req.user._id;
        const room = await ChatRoom.findById(req.params.roomId);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        // Permission check
        if (room.type === 'dm') {
            if (!room.participants.some(p => p.toString() === uid.toString())) {
                return res.status(403).json({ success: false, message: 'Not a participant' });
            }
        } else if (room.type === 'group') {
            const membership = await GroupMembership.findOne({ group_id: room.group_id, user_id: uid });
            if (!membership) {
                return res.status(403).json({ success: false, message: 'Not a member of this group' });
            }
        }

        const limit = parseInt(req.query.limit) || 50;
        const before = req.query.cursor ? { createdAt: { $lt: new Date(req.query.cursor) } } : {};

        const messages = await ChatMessage.find({ room_id: room._id, is_deleted: false, ...before })
            .populate('sender_id', 'name avatar_url phone')
            .sort({ createdAt: -1 })
            .limit(limit + 1);

        const hasMore = messages.length > limit;
        const result = messages.slice(0, limit).reverse();
        const nextCursor = hasMore ? messages[limit].createdAt.toISOString() : null;

        res.json({ success: true, data: result, nextCursor });
    } catch (err) { next(err); }
});

module.exports = router;
