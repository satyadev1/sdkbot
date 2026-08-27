export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fakeClock(initial: Date): Clock & { advance(ms: number): void; set(date: Date): void } {
  let current = new Date(initial.getTime());
  return {
    now: () => new Date(current.getTime()),
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    set: (date: Date) => {
      current = new Date(date.getTime());
    },
  };
}
