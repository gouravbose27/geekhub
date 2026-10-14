import type { DB } from '../db';
import { contributionDates } from '../git/cli';
import { repoPath } from './repos';
import type { Repo } from './repos';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_YEAR = 365;

export interface ContributionDay {
  date: string;
  count: number;
  level: number;
}

export interface ContributionWeek {
  days: ContributionDay[];
}

export interface ContributionCalendar {
  total: number;
  maxCount: number;
  weeks: ContributionWeek[];
}

interface ContributionUser {
  id: number;
  username: string;
  email: string;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function levelFor(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0;
  return Math.max(1, Math.ceil((count / maxCount) * 4));
}

function buildCalendar(counts: Map<string, number>, today = new Date()): ContributionCalendar {
  const end = startOfUtcDay(today);
  const firstContributionDay = new Date(end.getTime() - (DAYS_IN_YEAR - 1) * DAY_MS);
  const start = new Date(firstContributionDay);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const maxCount = Math.max(0, ...counts.values());
  const weeks: ContributionWeek[] = [];
  let week: ContributionDay[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const key = dateKey(cursor);
    const count = cursor < firstContributionDay ? 0 : counts.get(key) ?? 0;
    week.push({ date: key, count, level: levelFor(count, maxCount) });
    if (week.length === 7) {
      weeks.push({ days: week });
      week = [];
    }
  }
  if (week.length) weeks.push({ days: week });

  return { total, maxCount, weeks };
}

export async function userContributions(db: DB, reposDir: string, user: ContributionUser): Promise<ContributionCalendar> {
  const today = startOfUtcDay(new Date());
  const since = new Date(today.getTime() - (DAYS_IN_YEAR - 1) * DAY_MS);
  const repos = db
    .prepare(
      `SELECT r.id, r.owner_id, u.username AS owner, r.name, r.description, r.created_at
       FROM repositories r JOIN users u ON u.id = r.owner_id`,
    )
    .all() as Repo[];
  const counts = new Map<string, number>();

  for (const repo of repos) {
    const dates = await contributionDates(repoPath(reposDir, repo.owner, repo.name), user.email, since);
    for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return buildCalendar(counts, today);
}
