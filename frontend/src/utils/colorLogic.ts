export interface RunCheck {
  id: string;
  runName: string;
  section: string;
  patroller: string;
  checkTime: Date;
  createdAt: Date;
}

export interface RunWithColor {
  name: string;
  section: string;
  color: 'red' | 'yellow' | 'green';
  lastCheck: RunCheck | null;
  minutesSinceCheck: number | null;
}

export function calculateRunColors(
  runs: { name: string; section: string }[],
  checks: RunCheck[]
): RunWithColor[] {
  const now = new Date();

  return runs.map(run => {
    // Find most recent check for this run
    const runChecks = checks
      .filter(c => c.runName === run.name && c.section === run.section)
      .sort((a, b) => new Date(b.checkTime).getTime() - new Date(a.checkTime).getTime());

    const lastCheck = runChecks[0] || null;
    const minutesSinceCheck = lastCheck
      ? (now.getTime() - new Date(lastCheck.checkTime).getTime()) / 1000 / 60
      : null;

    let color: 'red' | 'yellow' | 'green' = 'red';

    if (minutesSinceCheck === null) {
      // Never checked
      color = 'red';
    } else if (minutesSinceCheck < 60) {
      // Less than 1 hour
      color = 'green';
    } else if (minutesSinceCheck < 120) {
      // 1-2 hours
      color = 'yellow';
    } else {
      // More than 2 hours
      color = 'red';
    }

    return {
      name: run.name,
      section: run.section,
      color,
      lastCheck,
      minutesSinceCheck,
    };
  });
}

export function groupRunsBySection(runs: RunWithColor[]): Map<string, RunWithColor[]> {
  const grouped = new Map<string, RunWithColor[]>();

  for (const run of runs) {
    if (!grouped.has(run.section)) {
      grouped.set(run.section, []);
    }
    grouped.get(run.section)!.push(run);
  }

  return grouped;
}

export function formatTimeSince(minutes: number | null): string {
  if (minutes === null) {
    return 'Never';
  }

  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${Math.floor(minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);

  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
