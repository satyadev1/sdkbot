export const DEFAULT_MAX_PINGS_PER_REMINDER = 3;
export const DEFAULT_MAX_DMS_PER_DAY = 10;

export function canSendReminderPing(
  pingsAlreadySentForReminder: number,
  maxPingsPerReminder: number = DEFAULT_MAX_PINGS_PER_REMINDER,
): boolean {
  return pingsAlreadySentForReminder < maxPingsPerReminder;
}

export function canSendAnyDm(
  dmsAlreadySentToday: number,
  maxDmsPerDay: number = DEFAULT_MAX_DMS_PER_DAY,
): boolean {
  return dmsAlreadySentToday < maxDmsPerDay;
}
