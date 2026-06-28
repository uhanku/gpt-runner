import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  ValidateIf,
  IsUrl,
  ValidateNested,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatGptFileReferenceDto {
  @ApiProperty({
    description: 'Filename to stage into the job workspace.',
    example: 'input.csv',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'HTTPS URL where the file bytes can be downloaded.',
    example: 'https://example.test/files/input.csv',
  })
  @ValidateIf(
    (object: ChatGptFileReferenceDto) =>
      object.download_link === undefined || object.download_url !== undefined,
  )
  @IsUrl({ protocols: ['https'], require_protocol: true })
  download_url?: string;

  @ApiPropertyOptional({
    description: 'Alias for download_url.',
    example: 'https://example.test/files/input.csv',
  })
  @ValidateIf((object: ChatGptFileReferenceDto) => object.download_link !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  download_link?: string;
}

export class CreateJobDto {
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
    description:
      'ChatGPT Action file references to download into /workspace before the job starts.',
    type: [ChatGptFileReferenceDto],
    maxItems: 10,
  })
  @IsOptional()
  @Transform(({ value }) => {
    const normalize = (items: unknown) => {
      if (!Array.isArray(items)) {
        return items;
      }

      return items.map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          !('download_url' in item) &&
          'download_link' in item
        ) {
          return {
            ...item,
            download_url: (item as { download_link?: unknown }).download_link,
          };
        }

        return item;
      });
    };

    if (Array.isArray(value)) {
      return normalize(value);
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    try {
      return normalize(JSON.parse(trimmed));
    } catch {
      return value;
    }
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatGptFileReferenceDto)
  openaiFileIdRefs?: ChatGptFileReferenceDto[];

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
