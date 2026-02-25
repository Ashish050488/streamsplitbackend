require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const BRAND = require('../../brand.config');

const User = require('../models/User');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Plan = require('../models/Plan');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const WalletAccount = require('../models/WalletAccount');
const Coupon = require('../models/Coupon');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/subspace';

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('🌱 Connected. Seeding...\n');

  // Clear everything
  await Promise.all([
    User.deleteMany(), Category.deleteMany(), Brand.deleteMany(),
    Plan.deleteMany(), Group.deleteMany(), GroupMembership.deleteMany(),
    GroupTransaction.deleteMany(), EarningsAccount.deleteMany(),
    WithdrawalRequest.deleteMany(), WalletAccount.deleteMany(), Coupon.deleteMany(),
  ]);

  // ─── Users ──────────────────────────────────────
  const userSpecs = [
    { phone: '+919999999999', name: 'Admin', role: 'super_admin', balance: 5000 },
    { phone: '+919900000001', name: 'Test A', role: 'user', balance: 500 },
    { phone: '+919900000002', name: 'Test B', role: 'user', balance: 250 },
    { phone: '+919900000003', name: 'Test C', role: 'user', balance: 1000 },
    { phone: '+919900000004', name: 'Test D', role: 'user', balance: 0 },
    { phone: '+919900000005', name: 'Test E', role: 'user', balance: 150 },
    { phone: '+919900000006', name: 'Test F', role: 'user', balance: 300 },
    { phone: '+919900000007', name: 'Test G', role: 'user', balance: 750 },
    { phone: '+919900000008', name: 'Test H', role: 'user', balance: 100 },
    { phone: '+919900000009', name: 'Test I', role: 'user', balance: 2000 },
    { phone: '+919900000010', name: 'Test J', role: 'user', balance: 50 },
  ];

  const users = [];
  for (const spec of userSpecs) {
    const u = await User.create({
      phone: spec.phone, name: spec.name, role: spec.role,
      referral_code: BRAND.slug.toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
    });
    await WalletAccount.create({ user_id: u._id, balance: spec.balance });
    await EarningsAccount.create({ user_id: u._id, withdrawable_balance: 0, total_earned: 0 });
    users.push(u);
  }

  const [admin, testA, testB, testC, testD, testE, testF, testG, testH, testI, testJ] = users;

  // ─── Categories ─────────────────────────────────
  const cats = await Category.insertMany([
    { name: 'OTT & Streaming', slug: 'ott-streaming', icon_url: '🎬', color: '#EF4444', sort_order: 1 },
    { name: 'Music', slug: 'music', icon_url: '🎵', color: '#10B981', sort_order: 2 },
    { name: 'Cloud & Storage', slug: 'cloud-storage', icon_url: '☁️', color: '#3B82F6', sort_order: 3 },
    { name: 'Gaming', slug: 'gaming', icon_url: '🎮', color: '#8B5CF6', sort_order: 4 },
    { name: 'Education', slug: 'education', icon_url: '📚', color: '#F59E0B', sort_order: 5 },
    { name: 'VPN & Security', slug: 'vpn-security', icon_url: '🔒', color: '#06B6D4', sort_order: 6 },
    { name: 'Productivity', slug: 'productivity', icon_url: '⚡', color: '#EC4899', sort_order: 7 },
    { name: 'Health & Fitness', slug: 'health-fitness', icon_url: '💪', color: '#14B8A6', sort_order: 8 },
  ]);

  // ─── Brands ─────────────────────────────────────
  const brands = await Brand.insertMany([
    { category_id: cats[0]._id, name: 'Netflix', slug: 'netflix', logo_url: '/images/logos/netflix.svg', brand_color: '#E50914', description: 'Stream movies & TV shows', tags: ['streaming', 'movies', 'series'], is_featured: true },
    { category_id: cats[0]._id, name: 'Disney+ Hotstar', slug: 'disney-hotstar', logo_url: '/images/logos/disney-hotstar.svg', brand_color: '#1A73E8', description: 'Movies, sports & original shows', tags: ['streaming', 'sports', 'disney'], is_featured: true },
    { category_id: cats[0]._id, name: 'Amazon Prime Video', slug: 'prime-video', logo_url: '/images/logos/prime-video.svg', brand_color: '#00A8E1', description: 'Stream & free delivery', tags: ['streaming', 'shopping'], is_featured: true },
    { category_id: cats[0]._id, name: 'YouTube Premium', slug: 'youtube-premium', logo_url: '/images/logos/youtube.svg', brand_color: '#FF0000', description: 'Ad-free videos & music', tags: ['streaming', 'music', 'youtube'], is_featured: true },
    { category_id: cats[1]._id, name: 'Spotify', slug: 'spotify', logo_url: '/images/logos/spotify.svg', brand_color: '#1DB954', description: 'Music for everyone', tags: ['music', 'podcast'], is_featured: true },
    { category_id: cats[1]._id, name: 'Apple Music', slug: 'apple-music', logo_url: '/images/logos/apple-music.svg', brand_color: '#FA2D48', description: '100M+ songs ad-free', tags: ['music', 'apple'] },
    { category_id: cats[2]._id, name: 'Google One', slug: 'google-one', logo_url: '/images/logos/google-one.svg', brand_color: '#4285F4', description: 'Cloud storage & VPN', tags: ['cloud', 'storage', 'google'] },
    { category_id: cats[3]._id, name: 'Xbox Game Pass', slug: 'xbox-game-pass', logo_url: '/images/logos/xbox.svg', brand_color: '#107C10', description: 'Hundreds of games', tags: ['gaming', 'xbox'], is_featured: true },
    { category_id: cats[4]._id, name: 'Coursera Plus', slug: 'coursera-plus', logo_url: '/images/logos/coursera.svg', brand_color: '#0056D2', description: 'Unlimited learning', tags: ['education', 'courses'] },
    { category_id: cats[5]._id, name: 'NordVPN', slug: 'nordvpn', logo_url: '/images/logos/nordvpn.svg', brand_color: '#4687FF', description: 'Secure internet access', tags: ['vpn', 'security', 'privacy'] },
    { category_id: cats[6]._id, name: 'Canva Pro', slug: 'canva-pro', logo_url: '/images/logos/canva.svg', brand_color: '#00C4CC', description: 'Design made easy', tags: ['design', 'productivity'] },
    { category_id: cats[7]._id, name: 'Cult.fit', slug: 'cult-fit', logo_url: '/images/logos/cultfit.svg', brand_color: '#FF3E6C', description: 'Fitness, mind & body', tags: ['fitness', 'gym', 'yoga'] },
  ]);

  // ─── Plans ──────────────────────────────────────
  const planData = [
    { brand: 0, name: 'Mobile', price: 149, original_price: 199, validity_days: 30 },
    { brand: 0, name: 'Basic', price: 199, original_price: 249, validity_days: 30 },
    { brand: 0, name: 'Standard', price: 499, original_price: 649, validity_days: 30 },
    { brand: 0, name: 'Premium', price: 649, original_price: 799, validity_days: 30 },
    { brand: 1, name: 'Mobile', price: 149, original_price: 199, validity_days: 30 },
    { brand: 1, name: 'Super', price: 299, original_price: 399, validity_days: 30 },
    { brand: 1, name: 'Premium', price: 499, original_price: 599, validity_days: 30 },
    { brand: 2, name: 'Monthly', price: 179, original_price: 299, validity_days: 30 },
    { brand: 2, name: 'Annual', price: 1499, original_price: 1999, validity_days: 365 },
    { brand: 3, name: 'Individual', price: 129, original_price: 179, validity_days: 30 },
    { brand: 3, name: 'Family', price: 189, original_price: 269, validity_days: 30 },
    { brand: 4, name: 'Individual', price: 119, original_price: 179, validity_days: 30 },
    { brand: 4, name: 'Duo', price: 149, original_price: 219, validity_days: 30 },
    { brand: 4, name: 'Family', price: 179, original_price: 269, validity_days: 30 },
    { brand: 5, name: 'Individual', price: 99, original_price: 129, validity_days: 30 },
    { brand: 6, name: '100GB', price: 130, original_price: 210, validity_days: 30 },
    { brand: 7, name: 'Core', price: 349, original_price: 499, validity_days: 30 },
    { brand: 7, name: 'Ultimate', price: 549, original_price: 749, validity_days: 30 },
    { brand: 8, name: 'Annual', price: 3999, original_price: 5999, validity_days: 365 },
    { brand: 9, name: '1 Month', price: 399, original_price: 599, validity_days: 30 },
    { brand: 9, name: '1 Year', price: 2999, original_price: 4499, validity_days: 365 },
    { brand: 10, name: 'Monthly', price: 499, original_price: 799, validity_days: 30 },
    { brand: 11, name: 'Monthly', price: 899, original_price: 1499, validity_days: 30 },
  ];

  await Plan.insertMany(planData.map(p => ({
    brand_id: brands[p.brand]._id, name: p.name, price: p.price,
    original_price: p.original_price, validity_days: p.validity_days,
  })));

  // ─── Groups (owned by different users) ──────────
  const groupSpecs = [
    // Admin-owned groups
    { name: 'Netflix Family Share', brand: 0, share_price: 162, share_limit: 4, owner: admin, desc: 'Premium plan split 4 ways' },
    { name: 'YouTube Premium Family', brand: 3, share_price: 50, share_limit: 6, owner: admin, desc: 'Ad-free YouTube for everyone' },
    // Test A-owned groups
    { name: 'Spotify Family Plan', brand: 4, share_price: 33, share_limit: 6, owner: testA, desc: 'Music streaming split 6 ways' },
    { name: 'Canva Pro Team', brand: 10, share_price: 100, share_limit: 5, owner: testA, desc: 'Design tools for the team' },
    // Test B-owned group
    { name: 'Disney+ Group Watch', brand: 1, share_price: 125, share_limit: 4, owner: testB, desc: 'Watch Disney+ together' },
    // Test C-owned groups
    { name: 'NordVPN Team', brand: 9, share_price: 66, share_limit: 6, owner: testC, desc: 'VPN protection for the group' },
    { name: 'Xbox Game Pass Squad', brand: 7, share_price: 110, share_limit: 5, owner: testC, desc: 'Game together for less' },
    // Test D-owned group (will be nearly full)
    { name: 'Coursera Plus Study Group', brand: 8, share_price: 200, share_limit: 4, owner: testD, desc: 'Learn together and save' },
  ];

  const groups = [];
  for (const gs of groupSpecs) {
    const g = await Group.create({
      name: gs.name,
      brand_id: brands[gs.brand]._id,
      is_public: true,
      share_price: gs.share_price,
      share_limit: gs.share_limit,
      member_count: 1,
      created_by: gs.owner._id,
      description: gs.desc,
      status: 'waiting',
      invite_code: crypto.randomBytes(4).toString('hex'),
    });
    // Owner membership
    await GroupMembership.create({ group_id: g._id, user_id: gs.owner._id, role: 'owner' });
    groups.push(g);
  }

  // ─── Add members to some groups (realistic fill levels) ──
  const addMember = async (group, user) => {
    const exists = await GroupMembership.findOne({ group_id: group._id, user_id: user._id });
    if (exists) return;
    await GroupMembership.create({ group_id: group._id, user_id: user._id, role: 'member' });
    group.member_count += 1;
    await group.save();
  };

  // Group 0 (Netflix): nearly full — 3/4 members
  await addMember(groups[0], testB);
  await addMember(groups[0], testC);

  // Group 1 (YouTube): 3/6 members
  await addMember(groups[1], testA);
  await addMember(groups[1], testD);

  // Group 2 (Spotify): 4/6 members
  await addMember(groups[2], testB);
  await addMember(groups[2], testC);
  await addMember(groups[2], testD);

  // Group 3 (Canva): 1/5 members (empty, only owner)
  // — left as is

  // Group 4 (Disney+): 2/4 members
  await addMember(groups[4], testE);

  // Group 5 (NordVPN): 1/6 (only owner)
  // — left as is

  // Group 6 (Xbox): full — 5/5
  await addMember(groups[6], testA);
  await addMember(groups[6], testB);
  await addMember(groups[6], testE);
  await addMember(groups[6], testF);
  // Mark as active since full
  groups[6].status = 'active';
  groups[6].start_date = new Date();
  groups[6].end_date = new Date(Date.now() + 30 * 86400000);
  await groups[6].save();

  // Group 7 (Coursera): 3/4 (nearly full)
  await addMember(groups[7], testG);
  await addMember(groups[7], testH);

  // ─── Coupons ────────────────────────────────────
  await Coupon.insertMany([
    { code: 'WELCOME50', type: 'percentage', value: 50, max_discount: 100, min_order_value: 100, usage_limit: 1000 },
    { code: 'FLAT100', type: 'flat', value: 100, min_order_value: 299, usage_limit: 500 },
    { code: 'SAVE20', type: 'percentage', value: 20, max_discount: 200, min_order_value: 200, usage_limit: -1 },
  ]);

  // ─── Print summary ─────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                  ✅ SEED COMPLETE                       ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Collection      │  Count                              ║');
  console.log('╟──────────────────┼─────────────────────────────────────╢');
  console.log(`║  Users           │  ${await User.countDocuments()}`.padEnd(59) + '║');
  console.log(`║  Categories      │  ${await Category.countDocuments()}`.padEnd(59) + '║');
  console.log(`║  Brands          │  ${await Brand.countDocuments()}`.padEnd(59) + '║');
  console.log(`║  Plans           │  ${await Plan.countDocuments()}`.padEnd(59) + '║');
  console.log(`║  Groups          │  ${await Group.countDocuments()}`.padEnd(59) + '║');
  console.log(`║  Coupons         │  ${await Coupon.countDocuments()}`.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  console.log('\n📋 Test Accounts:');
  console.log('┌──────────┬────────────────────┬──────────────┬──────────┐');
  console.log('│ Name     │ Phone              │ Role         │ Balance  │');
  console.log('├──────────┼────────────────────┼──────────────┼──────────┤');
  for (const spec of userSpecs) {
    const name = spec.name.padEnd(8);
    const phone = spec.phone.padEnd(18);
    const role = spec.role.padEnd(12);
    const bal = `₹${spec.balance}`.padEnd(8);
    console.log(`│ ${name} │ ${phone} │ ${role} │ ${bal} │`);
  }
  console.log('└──────────┴────────────────────┴──────────────┴──────────┘');

  console.log('\n📎 Invite Codes:');
  console.log('┌──────────────────────────────────┬──────────────┐');
  console.log('│ Group                            │ Invite Code  │');
  console.log('├──────────────────────────────────┼──────────────┤');
  for (const g of groups) {
    const name = g.name.padEnd(32);
    const code = g.invite_code.padEnd(12);
    console.log(`│ ${name} │ ${code} │`);
  }
  console.log('└──────────────────────────────────┴──────────────┘');

  console.log('\n🔑 Groups Status:');
  for (const g of groups) {
    const fill = `${g.member_count}/${g.share_limit}`;
    const status = g.status.toUpperCase();
    const bar = '█'.repeat(g.member_count) + '░'.repeat(g.share_limit - g.member_count);
    console.log(`  ${g.name.padEnd(30)} [${bar}] ${fill.padEnd(5)} ${status}`);
  }

  console.log('\n🚀 Ready! Login with any test account. OTP_PROVIDER=console → check backend console for OTP.');
  console.log('   Or set DEV_SHOW_OTP=true → OTP appears in AuthModal automatically.\n');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
