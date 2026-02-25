const router = require('express').Router();
const crypto = require('crypto');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const BRAND = require('../../brand.config');

// ─── POST /payments/razorpay/webhook ─────────────────────────
router.post('/razorpay/webhook', async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            console.warn('⚠️ RAZORPAY_WEBHOOK_SECRET not set — skipping webhook');
            return res.status(200).json({ status: 'ok' });
        }

        // Verify signature
        const signature = req.headers['x-razorpay-signature'];
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (signature !== expectedSig) {
            console.error('❌ Webhook signature mismatch');
            return res.status(400).json({ status: 'invalid_signature' });
        }

        const event = req.body.event;
        const payload = req.body.payload;

        if (event === 'payment.captured' || event === 'order.paid') {
            const payment = payload.payment?.entity;
            const orderId = payment?.order_id || payload.order?.entity?.id;
            const paymentId = payment?.id;

            if (!orderId || !paymentId) {
                return res.status(200).json({ status: 'missing_ids' });
            }

            // Idempotency: check if already processed
            const existingTx = await GroupTransaction.findOne({ razorpay_payment_id: paymentId });
            if (existingTx && existingTx.status === 'paid') {
                return res.status(200).json({ status: 'already_processed' });
            }

            // Find the pending transaction by razorpay_order_id
            const tx = await GroupTransaction.findOne({ razorpay_order_id: orderId, status: 'pending' });
            if (!tx) {
                console.warn(`⚠️ No pending transaction for order ${orderId}`);
                return res.status(200).json({ status: 'no_pending_tx' });
            }

            // Mark as paid
            tx.razorpay_payment_id = paymentId;
            tx.status = 'paid';
            await tx.save();

            // Add membership (idempotent)
            const existingMembership = await GroupMembership.findOne({
                group_id: tx.group_id, user_id: tx.buyer_id,
            });
            if (!existingMembership) {
                await GroupMembership.create({
                    group_id: tx.group_id, user_id: tx.buyer_id, role: 'member',
                });

                // Increment member_count + check if full
                const updated = await Group.findByIdAndUpdate(
                    tx.group_id,
                    { $inc: { member_count: 1 } },
                    { new: true }
                );

                if (updated && updated.member_count >= updated.share_limit) {
                    updated.status = 'active';
                    updated.start_date = new Date();
                    updated.end_date = new Date(Date.now() + (updated.duration_days || 30) * 86400000);
                    await updated.save();
                }
            }

            // Credit owner earnings (atomic)
            await EarningsAccount.findOneAndUpdate(
                { user_id: tx.owner_id },
                { $inc: { withdrawable_balance: tx.net, total_earned: tx.net } },
                { upsert: true }
            );

            console.log(`✅ Webhook: Payment ${paymentId} processed — ₹${tx.gross} (fee ₹${tx.fee_amount}, net ₹${tx.net})`);
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('❌ Webhook error:', err.message);
        res.status(200).json({ status: 'error' }); // Always 200 to prevent retries
    }
});

// ─── POST /payments/verify-join — Frontend-initiated verification ──
router.post('/verify-join', async (req, res, next) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Missing payment fields' });
        }

        // Verify signature
        const expectedSig = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (expectedSig !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }

        // Find pending transaction
        const tx = await GroupTransaction.findOne({ razorpay_order_id, status: 'pending' });
        if (!tx) {
            // Might already be processed by webhook
            const existing = await GroupTransaction.findOne({ razorpay_payment_id });
            if (existing && existing.status === 'paid') {
                return res.json({ success: true, data: { group_id: existing.group_id, message: 'Payment already verified' } });
            }
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        // Mark as paid
        tx.razorpay_payment_id = razorpay_payment_id;
        tx.status = 'paid';
        await tx.save();

        // Add membership (idempotent)
        const existingMembership = await GroupMembership.findOne({
            group_id: tx.group_id, user_id: tx.buyer_id,
        });
        if (!existingMembership) {
            await GroupMembership.create({
                group_id: tx.group_id, user_id: tx.buyer_id, role: 'member',
            });

            const updated = await Group.findByIdAndUpdate(
                tx.group_id,
                { $inc: { member_count: 1 } },
                { new: true }
            );
            if (updated && updated.member_count >= updated.share_limit) {
                updated.status = 'active';
                updated.start_date = new Date();
                updated.end_date = new Date(Date.now() + (updated.duration_days || 30) * 86400000);
                await updated.save();
            }
        }

        // Credit owner
        await EarningsAccount.findOneAndUpdate(
            { user_id: tx.owner_id },
            { $inc: { withdrawable_balance: tx.net, total_earned: tx.net } },
            { upsert: true }
        );

        res.json({ success: true, data: { group_id: tx.group_id, message: 'Payment verified, membership created' } });
    } catch (err) { next(err); }
});

module.exports = router;
