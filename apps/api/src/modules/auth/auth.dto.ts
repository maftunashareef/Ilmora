import { Equals, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'

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
  @IsString()
  phone?: string

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en'

  /** Section 3.2 of the offer: acceptance is an explicit mark at registration; 9.1: personal-data consent is a separate mark. */
  @Equals(true)
  acceptOffer!: true

  @Equals(true)
  consentPersonalData!: true
}

/** Existing accounts (one-time-code sign-ups, demo accounts, older editions) confirm the current edition from the workspace. */
export class ConsentDto {
  @Equals(true)
  acceptOffer!: true

  @Equals(true)
  consentPersonalData!: true
}

export class PasswordLoginDto {
  @IsString()
  @Length(1, 64)
  login!: string

  @IsString()
  @Length(1, 128)
  password!: string
}

export class GoogleAuthDto {
  @IsOptional()
  @IsString()
  idToken?: string

  @IsOptional()
  @IsString()
  code?: string

  @IsOptional()
  @IsString()
  redirectUri?: string

  @IsOptional()
  @IsIn(['STUDENT', 'TEACHER'])
  role?: 'STUDENT' | 'TEACHER'

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en'
}
