import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function normalizeOpenAiFileRefs(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export class CreateJobDto {}

export class StartJobDto {
  @ApiPropertyOptional({
    description: 'Optional git repository URL to clone before running commands.',
    example: 'https://github.com/pallets/flask.git',
  })
  @IsOptional()
  @IsString()
  repo_url?: string;

  @ApiPropertyOptional({
    description: 'Optional branch, tag, or ref to clone.',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiProperty({
    description: 'Shell commands to run inside the temporary container.',
    example: [
      'python3 --version',
      'python3 -m venv .venv',
      '. .venv/bin/activate && pip install -e .',
      '. .venv/bin/activate && pytest',
    ],
  })
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }

    return [value];
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  commands!: string[];

  @ApiPropertyOptional({
    description: 'Maximum runtime in seconds.',
    default: 300,
    maximum: 900,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(900)
  timeout_seconds?: number = 300;

  @ApiPropertyOptional({
    description: 'Whether the runner container should have network access.',
    enum: ['on', 'off'],
    default: 'on',
  })
  @IsOptional()
  @IsIn(['on', 'off'])
  network?: 'on' | 'off' = 'on';

  @ApiPropertyOptional({
    description:
      'Run as root inside the disposable container. Needed for apt install. Riskier.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  root?: boolean = false;
}

export class UploadJobFilesDto {
  @IsOptional()
  @IsString()
  file?: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({
    description:
      'ChatGPT Action file reference string to download into /workspace/input.png.',
    type: [String],
    maxItems: 1,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeOpenAiFileRefs(value))
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  openaiFileIdRefs?: string[];
}
