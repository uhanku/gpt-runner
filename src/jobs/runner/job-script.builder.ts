import { Injectable } from '@nestjs/common';
import {
  RunJobCommandsDto,
  StartJobDto,
} from '../dto/create-job.dto';

@Injectable()
export class JobScriptBuilder {
  bootstrapScript(dto: StartJobDto): string {
    const lines = this.commonPrelude('installing workspace dependencies');

    if (dto.repo_url) {
      let cloneCommand = 'git clone';

      if (dto.branch) {
        cloneCommand += ` --branch ${this.shQuote(dto.branch)}`;
      }

      cloneCommand += ` ${this.shQuote(dto.repo_url)} repo`;
      lines.push('rm -rf repo');
      lines.push(cloneCommand);
      lines.push('cd repo');
    }

    lines.push(this.workspaceDependencyScript());
    lines.push("echo '[gpt-runner] finished at:' $(date -Iseconds)");

    return lines.join('\n') + '\n';
  }

  commandsScript(dto: RunJobCommandsDto): string {
    const lines = this.commonPrelude('running commands');

    lines.push('if [ -d repo ]; then');
    lines.push('  cd repo');
    lines.push('fi');

    let addedPytestBootstrap = false;

    for (const command of dto.commands) {
      if (!addedPytestBootstrap && this.needsPytestBootstrap(command)) {
        lines.push(this.pytestBootstrapScript());
        addedPytestBootstrap = true;
      }

      lines.push(command);
    }

    lines.push("echo '[gpt-runner] finished at:' $(date -Iseconds)");

    return lines.join('\n') + '\n';
  }

  safeScript(dto: RunJobCommandsDto): string {
    return this.commandsScript(dto);
  }

  private commonPrelude(action: string): string[] {
    return [
      'set -euo pipefail',
      'cd /workspace',
      "echo '[gpt-runner] started at:' $(date -Iseconds)",
      "echo '[gpt-runner] user:' $(id)",
      `echo '[gpt-runner] ${action}'`,
    ];
  }

  private workspaceDependencyScript(): string {
    return [
      'if [ -f package.json ] && command -v npm >/dev/null 2>&1; then',
      '  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then',
      '    npm ci',
      '  else',
      '    npm install',
      '  fi',
      'fi',
      'if [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ] || [ -f setup.cfg ]; then',
      '  if command -v python3 >/dev/null 2>&1; then',
      '    python3 -m venv .venv',
      '    . .venv/bin/activate',
      '    python -m pip install --upgrade pip setuptools wheel',
      '    if [ -f requirements.txt ]; then',
      '      python -m pip install -r requirements.txt',
      '    fi',
      '    if [ -f pyproject.toml ] || [ -f setup.py ] || [ -f setup.cfg ]; then',
      '      python -m pip install -e .',
      '    fi',
      '  fi',
      'fi',
      'if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then',
      '  cargo fetch',
      'fi',
      'if [ -f go.mod ] && command -v go >/dev/null 2>&1; then',
      '  go mod download',
      'fi',
      'if [ -f Gemfile ] && command -v bundle >/dev/null 2>&1; then',
      '  bundle install',
      'fi',
    ].join('\n');
  }

  private needsPytestBootstrap(command: string): boolean {
    return /(?:^|[\s;&|()])pytest(?:\s|$)/.test(command);
  }

  private pytestBootstrapScript(): string {
    return [
      'if [ -f .venv/bin/activate ]; then',
      '  . .venv/bin/activate',
      "  python -m pip install 'pytest<9'",
      '  if [ -f pyproject.toml ]; then',
      "    python - <<'PY'",
      'import pathlib',
      'import tomllib',
      '',
      'pyproject = pathlib.Path("pyproject.toml")',
      'requirements = pathlib.Path("/tmp/gpt-runner-test-requirements.txt")',
      'data = tomllib.loads(pyproject.read_text("utf8"))',
      'deps = data.get("dependency-groups", {}).get("tests", [])',
      'requirements.write_text(',
      '    "\\n".join(dep for dep in deps if isinstance(dep, str)),',
      '    "utf8",',
      ')',
      'PY',
      '    if [ -s /tmp/gpt-runner-test-requirements.txt ]; then',
      '      python -m pip install -r /tmp/gpt-runner-test-requirements.txt',
      '    fi',
      '  fi',
      'fi',
    ].join('\n');
  }

  private shQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}
