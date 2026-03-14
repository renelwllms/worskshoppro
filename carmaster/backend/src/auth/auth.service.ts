import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '@prisma/client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private msalClient?: ConfidentialClientApplication;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const tenantId = this.configService.get<string>('AZURE_TENANT_ID');
    const clientId = this.configService.get<string>('AZURE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('AZURE_CLIENT_SECRET');
    if (tenantId && clientId && clientSecret) {
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          clientSecret,
        },
      });
    }
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('User already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash,
        provider: AuthProvider.LOCAL,
        role: dto.role ?? 'staff',
      },
    });
    return this.signUser(user);
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.provider !== AuthProvider.LOCAL || !user.passwordHash) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    return user;
  }

  async login(user: any) {
    return this.signUser(user);
  }

  async azureLoginUrl() {
    if (!this.msalClient) {
      throw new BadRequestException('Azure AD is not configured');
    }
    const redirectUri = this.configService.get<string>('AZURE_REDIRECT_URI');
    if (!redirectUri) throw new BadRequestException('Missing AZURE_REDIRECT_URI');
    const scopes = ['User.Read', 'email', 'profile', 'offline_access'];
    return this.msalClient.getAuthCodeUrl({ scopes, redirectUri });
  }

  async handleAzureCallback(code: string) {
    if (!this.msalClient) {
      throw new BadRequestException('Azure AD is not configured');
    }
    const redirectUri = this.configService.get<string>('AZURE_REDIRECT_URI');
    if (!redirectUri) throw new BadRequestException('Missing AZURE_REDIRECT_URI');
    const scopes = ['User.Read', 'email', 'profile', 'offline_access'];
    const tokenResponse = await this.msalClient.acquireTokenByCode({
      code,
      scopes,
      redirectUri,
    });
    const email = tokenResponse?.account?.username;
    if (!email || !email.endsWith('@carmaster.co.nz')) {
      throw new UnauthorizedException('Only carmaster.co.nz accounts are allowed');
    }
    const displayName = tokenResponse.account?.name ?? email;
    const user = await this.prisma.user.upsert({
      where: { email },
      update: { displayName, provider: AuthProvider.AZURE },
      create: { email, displayName, provider: AuthProvider.AZURE },
    });
    return this.signUser(user);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  private signUser(user: { id: string; email: string; displayName: string; role: string }) {
    const payload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: payload,
    };
  }
}
