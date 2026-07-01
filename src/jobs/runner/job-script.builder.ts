import { Injectable } from '@nestjs/common';
import { StartJobDto } from '../dto/create-job.dto';

@Injectable()
export class JobScriptBuilder {
  safeScript(dto: StartJobDto): string {
    const lines = [
      'set -euo pipefail',
      'cd /workspace',
      "echo '[gpt-runner] started at:' $(date -Iseconds)",
      "echo '[gpt-runner] user:' $(id)",
    ];

    if (dto.repo_url) {
      let cloneCommand = 'git clone';

      if (dto.branch) {
        cloneCommand += ` --branch ${this.shQuote(dto.branch)}`;
      }

      cloneCommand += ` ${this.shQuote(dto.repo_url)} repo`;
      lines.push(cloneCommand);
      lines.push('cd repo');
    }

    lines.push("echo '[gpt-runner] running commands'");
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
