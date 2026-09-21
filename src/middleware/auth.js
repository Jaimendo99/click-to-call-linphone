import { ROLES } from '../lib/constants.js';

export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    res.status(401).json({ error: 'Debes iniciar sesión' });
    return;
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) {
      res.status(401).json({ error: 'Debes iniciar sesión' });
      return;
    }
    if (!roles.includes(req.session.user.role)) {
      res.status(403).json({ error: 'No tienes permiso' });
      return;
    }
    next();
  };
}

export function requireAdmin(req, res, next) {
  return requireRole(ROLES.ADMIN)(req, res, next);
}

export function requireAdvisor(req, res, next) {
  return requireRole(ROLES.ADVISOR)(req, res, next);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    created_at: user.created_at,
  };
}
