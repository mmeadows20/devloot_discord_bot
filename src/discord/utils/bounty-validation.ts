export const SUPPORTED_CURRENCIES = ['USDC', 'SOL', 'ETH'] as const;
export type BountyCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 100;
export const SUMMARY_MIN_LENGTH = 10;
export const SUMMARY_MAX_LENGTH = 1000;
export const MAX_REWARD_AMOUNT = 1_000_000_000;

const REPOSITORY_SEGMENT = '[A-Za-z0-9_.-]+';
const REPOSITORY_REGEX = new RegExp(
  `^(${REPOSITORY_SEGMENT})/(${REPOSITORY_SEGMENT})$`,
);
const GITHUB_REPOSITORY_PREFIX_REGEX =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\//i;
const TRAILING_SLASHES_REGEX = /\/+$/;
const GITHUB_ISSUE_PATH_REGEX =
  /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/;
const REWARD_AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const DEADLINE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface RepositoryRef {
  owner: string;
  repo: string;
  fullName: string;
}

export interface GitHubIssueRef extends RepositoryRef {
  issueNumber: number;
  url: string;
}

export function parseRepository(input: string): RepositoryRef | null {
  const value = input
    .trim()
    .replace(GITHUB_REPOSITORY_PREFIX_REGEX, '')
    .replace(TRAILING_SLASHES_REGEX, '');
  const match = REPOSITORY_REGEX.exec(value);
  if (!match) return null;

  const [, owner, repo] = match;
  if (owner.length > 100 || repo.length > 100) return null;

  return { owner, repo, fullName: `${owner}/${repo}` };
}

export function parseGitHubIssueUrl(input: string): GitHubIssueRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  const match = GITHUB_ISSUE_PATH_REGEX.exec(url.pathname);
  if (!match) return null;

  const [, owner, repo, issueNumberText] = match;
  const issueNumber = Number.parseInt(issueNumberText, 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return null;

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    issueNumber,
    url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
  };
}

export function repositoryMatchesIssue(
  repository: RepositoryRef,
  issue: GitHubIssueRef,
): boolean {
  return (
    repository.owner.toLowerCase() === issue.owner.toLowerCase() &&
    repository.repo.toLowerCase() === issue.repo.toLowerCase()
  );
}

export function normalizeTitle(input: string): string | null {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < TITLE_MIN_LENGTH || value.length > TITLE_MAX_LENGTH) {
    return null;
  }
  return value;
}

export function normalizeSummary(input: string): string | null {
  const value = input.trim();
  if (value.length < SUMMARY_MIN_LENGTH || value.length > SUMMARY_MAX_LENGTH) {
    return null;
  }
  return value;
}

export function parseRewardAmount(input: string): number | null {
  const value = input.trim();
  if (!REWARD_AMOUNT_REGEX.test(value)) return null;

  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_REWARD_AMOUNT
  ) {
    return null;
  }
  return amount;
}

export function parseDeadline(
  input: string,
  now: Date = new Date(),
): Date | null {
  const match = DEADLINE_REGEX.exec(input.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const deadline = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  const isRealDate =
    deadline.getUTCFullYear() === year &&
    deadline.getUTCMonth() === month - 1 &&
    deadline.getUTCDate() === day;
  if (!isRealDate || deadline.getTime() <= now.getTime()) return null;

  return deadline;
}

export function formatDeadlineInput(deadline: Date): string {
  return deadline.toISOString().slice(0, 10);
}

export function formatRewardAmount(amount: number): string {
  return Number(amount.toFixed(6)).toString();
}

export function isBountyCurrency(value: string): value is BountyCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
