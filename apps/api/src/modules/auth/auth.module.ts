import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ENV, type Env } from '../../config/env'
import { SmsModule } from '../sms/sms.module'
import { AccountService } from './account.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { OtpService } from './otp.service'
import { TokenService } from './token.service'

@Global()
@Module({
  imports: [
    SmsModule,
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'ilmora-api', audience: 'ilmora' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'ilmora-api', audience: 'ilmora' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AccountService, AuthService, OtpService, TokenService],
  exports: [TokenService, AuthService, AccountService],
})
export class AuthModule {}
