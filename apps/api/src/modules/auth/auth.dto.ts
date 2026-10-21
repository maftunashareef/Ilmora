import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'

export class RequestOtpDto {
  @IsString()
  @Length(7, 20)
  phone!: string

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en'
}

export class VerifyOtpDto {
  @IsString()
  @Length(7, 20)
  phone!: string

  @IsString()
  @Matches(/^\d{4,8}$/)
  code!: string

  @IsOptional()
  @IsString()
  @Length(2, 60)
  displayName?: string

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en'
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  displayName?: string

  @IsOptional()
  @IsString()
  @Length(0, 60)
  district?: string

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  preferredLang?: 'uz' | 'ru' | 'en'

  @IsOptional()
  @IsIn([true, false])
  reminders?: boolean
}

/** Public registration: only the two self-service roles exist; anything else is rejected by validation. */
export class RegisterDto {
  @IsIn(['STUDENT', 'TEACHER'])
  role!: 'STUDENT' | 'TEACHER'

  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  login!: string

  @IsString()
  @Length(8, 128)
  password!: string

  @IsOptional()
  @IsString()
  @Length(2, 60)
  displayName?: string

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en'
}

export class PasswordLoginDto {
  @IsString()
  @Length(1, 64)
  login!: string

  @IsString()
  @Length(1, 128)
  password!: string
}
