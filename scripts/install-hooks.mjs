// Installs the git hooks (`lefthook.yml`), as the last part of `pnpm install` (the `prepare` script). A folder that
// isn't a git repository yet (the template downloaded without its history, an image build) has nowhere to put them,
// and `lefthook install` fails there, which used to fail the whole install. Run `pnpm install` again after `git init`.
import { execFileSync } from "node:child_process";

function insideRepository() {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (insideRepository()) {
  execFileSync("pnpm", ["exec", "lefthook", "install"], { stdio: "inherit" });
} else {
  console.log("Not a git repository: the git hooks were not installed. Run `pnpm install` again after `git init`.");
}
