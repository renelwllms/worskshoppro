import { ReminderChannel } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SendScheduleRemindersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scheduleIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  daysAhead?: number;

  @IsOptional()
  @IsBoolean()
  includeOverdue?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(ReminderChannel, { each: true })
  channels?: ReminderChannel[];
}
