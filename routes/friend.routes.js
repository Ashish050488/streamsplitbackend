const router = require('express').Router();
const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

// Helpers
function sortedPair(a, b) {
    return a.toString() < b.toString() ? [a, b] : [b, a];
}

function maskPhone(phone) {
    if (!phone || phone.length < 6) return '****';
    return phone.slice(0, 4) + '******' + phone.slice(-2);
}

// ─── GET /friends — My friend list ──────────────────────────
router.get('/', authenticate, async (req, res, next) => {
    try {
        const uid = req.user._id;
        const friendships = await Friendship.find({ $or: [{ user_a: uid }, { user_b: uid }] })
            .sort({ createdAt: -1 });

        const friendIds = friendships.map(f =>
            f.user_a.toString() === uid.toString() ? f.user_b : f.user_a
        );

        const users = await User.find({ _id: { $in: friendIds } }).select('name phone avatar_url');
        const friends = users.map(u => ({
            _id: u._id,
            name: u.name,
            phone_masked: maskPhone(u.phone),
        }));

        res.json({ success: true, data: friends });
    } catch (err) { next(err); }
});

// ─── POST /friends/request — Send friend request ────────────
router.post('/request', authenticate, async (req, res, next) => {
    try {
        const { to_user_id } = req.body;
        const uid = req.user._id;

        if (!to_user_id) return res.status(400).json({ success: false, message: 'to_user_id required' });
        if (to_user_id === uid.toString()) return res.status(400).json({ success: false, message: 'Cannot friend yourself' });

        // Check target exists
        const target = await User.findById(to_user_id);
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });

        // Check already friends
        const [a, b] = sortedPair(uid, to_user_id);
        const existing = await Friendship.findOne({ user_a: a, user_b: b });
        if (existing) return res.status(409).json({ success: false, message: 'Already friends' });

        // Check existing pending request in either direction
        const pendingAB = await FriendRequest.findOne({ from_user: uid, to_user: to_user_id, status: 'pending' });
        if (pendingAB) return res.status(409).json({ success: false, message: 'Request already sent' });

        const pendingBA = await FriendRequest.findOne({ from_user: to_user_id, to_user: uid, status: 'pending' });
        if (pendingBA) {
            // Auto-accept if other person already requested us
            pendingBA.status = 'accepted';
            await pendingBA.save();
            await Friendship.create({ user_a: a, user_b: b });
            return res.json({ success: true, message: 'Friend request from them accepted!', data: { auto_accepted: true } });
        }

        const request = await FriendRequest.create({ from_user: uid, to_user: to_user_id });
        res.status(201).json({ success: true, data: request });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ success: false, message: 'Request already exists' });
        next(err);
    }
});

// ─── GET /friends/requests — Incoming + outgoing pending ────
router.get('/requests', authenticate, async (req, res, next) => {
    try {
        const uid = req.user._id;
        const incoming = await FriendRequest.find({ to_user: uid, status: 'pending' })
            .populate('from_user', 'name phone avatar_url')
            .sort({ createdAt: -1 });

        const outgoing = await FriendRequest.find({ from_user: uid, status: 'pending' })
            .populate('to_user', 'name phone avatar_url')
            .sort({ createdAt: -1 });

        const formatIncoming = incoming.map(r => ({
            _id: r._id,
            user: { _id: r.from_user._id, name: r.from_user.name, phone_masked: maskPhone(r.from_user.phone) },
            direction: 'incoming',
            created_at: r.createdAt,
        }));

        const formatOutgoing = outgoing.map(r => ({
            _id: r._id,
            user: { _id: r.to_user._id, name: r.to_user.name, phone_masked: maskPhone(r.to_user.phone) },
            direction: 'outgoing',
            created_at: r.createdAt,
        }));

        res.json({ success: true, data: { incoming: formatIncoming, outgoing: formatOutgoing } });
    } catch (err) { next(err); }
});

// ─── POST /friends/requests/:id/accept ──────────────────────
router.post('/requests/:id/accept', authenticate, async (req, res, next) => {
    try {
        const request = await FriendRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        if (request.to_user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not your request to accept' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request already ${request.status}` });
        }

        request.status = 'accepted';
        await request.save();

        const [a, b] = sortedPair(request.from_user, request.to_user);
        await Friendship.findOneAndUpdate({ user_a: a, user_b: b }, { user_a: a, user_b: b }, { upsert: true });

        res.json({ success: true, message: 'Friend request accepted' });
    } catch (err) { next(err); }
});

// ─── POST /friends/requests/:id/reject ──────────────────────
router.post('/requests/:id/reject', authenticate, async (req, res, next) => {
    try {
        const request = await FriendRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        if (request.to_user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not your request to reject' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request already ${request.status}` });
        }

        request.status = 'rejected';
        await request.save();
        res.json({ success: true, message: 'Friend request rejected' });
    } catch (err) { next(err); }
});

// ─── POST /friends/requests/:id/cancel ──────────────────────
router.post('/requests/:id/cancel', authenticate, async (req, res, next) => {
    try {
        const request = await FriendRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        if (request.from_user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not your request to cancel' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request already ${request.status}` });
        }

        request.status = 'cancelled';
        await request.save();
        res.json({ success: true, message: 'Friend request cancelled' });
    } catch (err) { next(err); }
});

module.exports = router;
