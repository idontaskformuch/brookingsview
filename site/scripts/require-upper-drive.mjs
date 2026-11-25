/**
 * QA build.lowercase-drive (owner 2026-11-25): never build or run the battery from a working directory with a lowercase Windows
 * drive letter. From "c:\..." `astro build` exits 0 but no page links its component CSS (432 of 433 Brookings pages, 2026-11-25);
 * the same code from "C:\..." is fine. Node sees "c:\..." after `cd /c/...` in Git Bash, "C:\..." after `cd C:/...` or `cd "$(pwd -W)"`.
 * Used by site/astro.config.mjs (every astro build/check/dev) and scripts/battery.sh (before any step).
 * Run directly: exits 1 with the message when the current directory is refused, 0 otherwise.
 */
/** The refusal message for this working directory, or null when it is fine (an uppercase drive letter, or no drive letter at all). */
export function driveLetterProblem(cwd) {
  const m = /^([a-z]):[\\/]/.exec(cwd);
  if (!m) return null;
  const fixed = m[1].toUpperCase() + cwd.slice(1);
  return [
    `REFUSED: the working directory has a lowercase drive letter: ${cwd}`,
    `A build from "${m[1]}:\\" finishes green with no component CSS on any page (QA build.lowercase-drive).`,
    `Change to "${fixed}" first: in Git Bash  cd "$(pwd -W)"  or  cd ${fixed.replace(/\\/g, '/')} ; in PowerShell  Set-Location "${fixed}".`,
  ].join('\n');
}

// Run directly (not imported). Compared by file name: comparing URLs could itself differ by the drive letter's case.
if (/require-upper-drive\.mjs$/.test(process.argv[1] ?? '')) {
  const problem = driveLetterProblem(process.cwd());
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
