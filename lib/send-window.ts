/**
 * US business-hours sending window. Cold email that lands at 3am reads as
 * automated, so campaigns only go out on weekdays inside these hours.
 */

/** IANA zone the window is measured in, e.g. America/New_York or America/Chicago. */
export const SEND_TIMEZONE = process.env.SEND_TIMEZONE ?? "America/New_York";

/** Local hours, 24h clock: sending runs from START up to (not including) END. */
const SEND_START_HOUR = Number(process.env.SEND_START_HOUR ?? 9);
const SEND_END_HOUR = Number(process.env.SEND_END_HOUR ?? 20);

/** 0 = Sunday … 6 = Saturday. */
const SEND_DAYS = (process.env.SEND_DAYS ?? "1,2,3,4,5").split(",").map(Number);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock fields for `date` as seen in the sending timezone. */
function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEND_TIMEZONE,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
    weekday: WEEKDAYS.indexOf(value("weekday")),
  };
}

export function isWithinSendWindow(date = new Date()) {
  const { weekday, hour } = zonedParts(date);
  return SEND_DAYS.includes(weekday) && hour >= SEND_START_HOUR && hour < SEND_END_HOUR;
}

/** Midnight today in the sending timezone — daily mailbox quotas reset here. */
export function startOfSendDay(date = new Date()) {
  const { year, month, day, hour, minute, second } = zonedParts(date);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = wallClock - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(year, month - 1, day) - offset);
}

/** Human description for error messages, e.g. "Mon–Fri 9:00–20:00 America/New_York". */
export function describeSendWindow() {
  const days =
    SEND_DAYS.join(",") === "1,2,3,4,5"
      ? "Mon–Fri"
      : SEND_DAYS.map((day) => WEEKDAYS[day]).join(", ");
  return `${days} ${SEND_START_HOUR}:00–${SEND_END_HOUR}:00 ${SEND_TIMEZONE}`;
}
