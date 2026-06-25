// XP curve + helpers shared by all aircraft.

export function xpToNextLevel(level) {
  return Math.floor(80 + level * 35);
}

export function killXpReward(victimLevel = 1) {
  return 45 + victimLevel * 28;
}

export function damageXpReward(amount) {
  return Math.max(1, Math.floor(amount * 0.75));
}

/** Add XP to an entity; returns how many levels were gained. */
export function grantXp(entity, amount) {
  if (!entity || amount <= 0) return 0;
  entity.xp = (entity.xp ?? 0) + amount;
  let levelsGained = 0;
  let level = entity.level ?? 1;

  while (entity.xp >= xpToNextLevel(level)) {
    entity.xp -= xpToNextLevel(level);
    level += 1;
    levelsGained += 1;
  }

  entity.level = level;
  return levelsGained;
}
