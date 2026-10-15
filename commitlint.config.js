/*===== Commit Message Rules =====*/
// Conventional Commits: `<type>(<optional scope>): <subject>`, e.g. `feat(note): add image upload`. Types: build, chore,
// ci, docs, feat, fix, perf, refactor, revert, style, test. Checked by the `commit-msg` hook (`lefthook.yml`).
export default {
  extends: ["@commitlint/config-conventional"],
};
