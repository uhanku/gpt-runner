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
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function normalizeOpenAiFileRefs(value: unknown, fallbackName = 'input.png') {
  const normalizeSingle = (ref: unknown, fallbackName: string) => {
    if (typeof ref === 'string') {
      const trimmed = ref.trim();
      if (!trimmed) {
        return ref;
      }

      return {
        name: fallbackName,
        download_url: trimmed,
        download_link: trimmed,
      };
    }

    if (!ref || typeof ref !== 'object') {
      return ref;
    }

    const fileRef = ref as Record<string, unknown>;
    return {
      name: typeof fileRef.name === 'string' && fileRef.name.trim() ? fileRef.name.trim() : fileRef.name,
      id: fileRef.id,
      mime_type: fileRef.mime_type,
      download_url:
        typeof fileRef.download_url === 'string' && fileRef.download_url.trim()
          ? fileRef.download_url.trim()
          : fileRef.download_link,
      download_link:
        typeof fileRef.download_link === 'string' && fileRef.download_link.trim()
          ? fileRef.download_link.trim()
          : fileRef.download_url,
    };
  };

  if (Array.isArray(value)) {
    return value.map((ref) => normalizeSingle(ref, fallbackName));
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map((ref) => normalizeSingle(ref, fallbackName)) : parsed;
  } catch {
    return value;
  }
}

export class OpenAiFileIdRefDto {
  name!: string;
  id?: string;
  mime_type?: string;
  download_url?: string;
  download_link?: string;
}

@ValidatorConstraint({ name: 'openAiFileIdRefs', async: false })
class OpenAiFileIdRefsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments) {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.every((item) => {
      if (typeof item === 'string') {
        return item.trim().length > 0;
      }

      if (!item || typeof item !== 'object') {
        return false;
      }

      const fileRef = item as Record<string, unknown>;
      const hasName = typeof fileRef.name === 'string' && fileRef.name.trim().length > 0;
      const hasDownloadUrl = typeof fileRef.download_url === 'string' && fileRef.download_url.trim().length > 0;
      const hasDownloadLink = typeof fileRef.download_link === 'string' && fileRef.download_link.trim().length > 0;

      return hasName && (hasDownloadUrl || hasDownloadLink);
    });
  }

  defaultMessage() {
    return 'openaiFileIdRefs must be an array of file references with a name and download URL';
  }
}

export class CreateJobDto {
  @ApiProperty({
    description: 'Docker image name used to run the job.',
    example: 'gpt-runner:spritefusion',
  })
  @IsString()
  docker_image_name!: string;

  @ApiProperty({
    description: 'The goal of the job.',
    example: 'Run the repository test suite and report failures.',
  })
  @IsString()
  goal!: string;

  @ApiPropertyOptional({
    description: 'The repository URL for the job.',
    example: 'https://github.com/pallets/flask.git',
  })
  @IsOptional()
  @IsString()
  repo_url?: string;
}

class JobExecutionOptionsDto {
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
    description: 'Run as root inside the disposable container. Needed for apt install. Riskier.',
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

export class StartJobDto extends JobExecutionOptionsDto {
  @ApiPropertyOptional({
    description: 'Optional git repository URL to clone before installing dependencies.',
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
}

export class RunJobCommandsDto extends JobExecutionOptionsDto {
  @ApiProperty({
    description: 'Shell commands to run inside the prepared workspace.',
    example: ['python3 --version', 'pytest'],
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
}

export class UploadJobFilesDto {
  @IsOptional()
  @IsString()
  file?: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({
    description: 'ChatGPT Action file reference string or file object to download into /workspace/input.png.',
    type: [String],
    maxItems: 1,
    items: {
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
            mime_type: { type: 'string' },
            download_url: { type: 'string' },
            download_link: { type: 'string' },
          },
        },
      ],
    },
  })
  @IsOptional()
  @Transform(({ value, obj }) =>
    normalizeOpenAiFileRefs(
      value,
      typeof obj?.filename === 'string' && obj.filename.trim() ? obj.filename.trim() : 'input.png',
    ),
  )
  @IsArray()
  @ArrayMaxSize(1)
  @Validate(OpenAiFileIdRefsConstraint)
  openaiFileIdRefs?: Array<string | OpenAiFileIdRefDto>;
}
