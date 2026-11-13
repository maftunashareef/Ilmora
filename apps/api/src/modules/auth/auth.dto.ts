import { Equals, IsIn, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator'
import { REGISTRY_INSTITUTION_TYPES, type RegistryInstitutionType } from '@ilmora/shared'

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

/**
 * Public registration: the self-service roles (a center registers as its first administrator, an institution as its
 * representative); anything else — MINISTRY above all — is rejected by validation.
 */
export class RegisterDto {
  @IsIn(['STUDENT', 'TEACHER', 'CENTER', 'INSTITUTION', 'COMPANY'])
  role!: 'STUDENT' | 'TEACHER' | 'CENTER' | 'INSTITUTION' | 'COMPANY'

  /** Educational Center only: the center's name (it starts as PENDING until the Super Admin approves it). */
  @ValidateIf((o: RegisterDto) => o.role === 'CENTER')
  @IsString()
  @Length(2, 120)
  centerName?: string

  /** Educational Center only: what it is — a learning center (the default), a university, a college… (`Center.kind`). */
  @ValidateIf((o: RegisterDto) => o.role === 'CENTER' && o.centerKind !== undefined)
  @IsIn(REGISTRY_INSTITUTION_TYPES)
  centerKind?: RegistryInstitutionType

  /** Institution or company representative only: their position (ТЗ 4.2 step 1, 4.3). */
  @ValidateIf((o: RegisterDto) => o.role === 'INSTITUTION' || o.role === 'COMPANY')
  @IsString()
  @Length(2, 80)
  jobTitle?: string

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

/** «Сменить пароль»: the current one and the new one (the same length rules as at registration). */
export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string

  @IsString()
  @Length(8, 128)
  newPassword!: string
}

/** «Забыл пароль»: the phone of the account, the SMS code (from POST /auth/otp/request) and the new password. */
export class ResetPasswordDto {
  @IsString()
  @Length(7, 20)
  phone!: string

  @IsString()
  @Matches(/^\d{4,8}$/)
  code!: string

  @IsString()
  @Length(8, 128)
  newPassword!: string
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

/** Second factor: the pass `/auth/login` answered (ministry and Super Admins). */
export class MfaChallengeBody {
  @IsString()
  @Length(20, 2000)
  challenge!: string
}

/** Second factor: the pass and a 6-digit code from the app — or, in `/auth/mfa/verify`, a recovery code «xxxx-xxxx». */
export class MfaCodeBody extends MfaChallengeBody {
  @IsString()
  @Length(6, 20)
  code!: string
}
