'use strict';
// Staff roles and what each one may do. The owner can do everything. Every staff API route
// names the permission it needs, so a moderator can never open the payouts queue, for example.

const ALL = ['overview', 'review', 'payouts', 'campaigns', 'users', 'users_manage', 'staff', 'support', 'website', 'settings', 'audit'];

const ROLES = {
  owner:     { label: 'Owner',             rank: 100, perms: ALL,                                                          about: 'Everything, including staff roles.' },
  admin:     { label: 'Admin',             rank: 90,  perms: ALL.filter(p => p !== 'staff'),                              about: 'Everything except changing staff roles.' },
  manager:   { label: 'Campaign manager',  rank: 60,  perms: ['overview', 'review', 'campaigns', 'users', 'users_manage', 'support'], about: 'Campaigns, clip reviews, clippers and support.' },
  moderator: { label: 'Moderator',         rank: 40,  perms: ['overview', 'review', 'support'],                           about: 'Checks accounts and clips, answers tickets.' },
  finance:   { label: 'Finance',           rank: 40,  perms: ['overview', 'payouts', 'users'],                            about: 'Payout requests, bonuses and corrections.' },
  support:   { label: 'Support',           rank: 30,  perms: ['overview', 'support', 'users'],                            about: 'Answers tickets and looks up clippers.' }
};
const STAFF_ROLES = Object.keys(ROLES);

// makeGate(whoAmI, validToken): builds the "who is calling" helpers used by the staff API.
//  - the old admin password (x-token header) counts as the owner
//  - otherwise the Discord login cookie is used, and the user's role decides
module.exports = function makeGate(whoAmI, validToken) {
  const actorOf = async q => {
    if (validToken(q.get('x-token'))) return { id: null, name: 'Owner (password)', role: 'owner', perms: ROLES.owner.perms, rank: ROLES.owner.rank, token: true };
    const u = await whoAmI(q);
    const r = u && ROLES[u.role];
    return r ? { id: u.id, name: u.username || 'Staff ' + u.id, role: u.role, perms: r.perms, rank: r.rank, user: u } : null;
  };
  const gate = perm => async (q, r, next) => {
    let a;
    try { a = await actorOf(q); } catch (e) { console.error(e); return r.status(500).json({ error: 'Something went wrong on our side. Please try again.' }); }
    if (!a) return r.status(401).json({ error: 'Please log in' });
    if (perm && !a.perms.includes(perm)) return r.status(403).json({ error: 'Your role cannot do this' });
    q.actor = a;
    next();
  };
  return { actorOf, gate };
};
module.exports.ROLES = ROLES;
module.exports.STAFF_ROLES = STAFF_ROLES;
module.exports.ALL_PERMS = ALL;
