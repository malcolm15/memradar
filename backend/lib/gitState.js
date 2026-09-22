// What commit is this process actually running against?
//
// WHY THIS EXISTS. The published-claim check reads baked HTML off disk
// (`bakedFloor` in claimRegistry.js), so its verdict is only ever true of the
// checked-out build. On the Actions runner that is whatever the job checked
// out, which is right. Run locally without pulling and it is not.
//
// THE INSTANCE THAT PROVED IT, 2026-09-22: `claim_floor_runs` id 1 recorded
// `withdrawn: ["data-ddr4-1y"]` from a forced local run whose working tree was
// one commit behind. The daily regen had restored that finding to /data/ two
// and a half hours earlier, so the row describes a page that had not existed
// since 13:58. Nothing in the row said so, because nothing recorded what it
// had read.
//
// Every function here returns null rather than throwing. Git being absent, or
// a detached checkout with no upstream, is a normal state on a runner and must
// never cost a price fetch.
const { execFileSync } = require('child_process');

const REPO_ROOT = require('path').join(__dirname, '..', '..');

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Short HEAD sha, or null if git is unavailable or this is not a repo. */
const head = () => git('rev-parse', '--short', 'HEAD') || null;

/** true when the working tree has uncommitted changes, false when clean, null when unknown. */
function isDirty() {
  const out = git('status', '--porcelain');
  return out == null ? null : out.length > 0;
}

/**
 * How many commits upstream has that we do not. 0 means current.
 * null means the question could not be asked: no upstream ref, which is the
 * normal case for the Actions checkout, and must NOT be read as "behind".
 */
function behindCount() {
  const out = git('rev-list', '--count', 'HEAD..@{u}');
  if (out == null || !/^\d+$/.test(out)) return null;
  return Number(out);
}

/**
 * One string for the record: "abc1234", "abc1234-dirty", "abc1234-behind:2",
 * or both suffixes. null when git cannot answer at all, which is honest: an
 * unknown commit is not the same as a clean one.
 */
function label() {
  const sha = head();
  if (!sha) return null;
  const parts = [sha];
  if (isDirty()) parts.push('dirty');
  const behind = behindCount();
  if (behind) parts.push(`behind:${behind}`);
  return parts.join('-');
}

module.exports = { head, isDirty, behindCount, label };
