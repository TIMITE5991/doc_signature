import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

const extractFromQueryOrHeader = (req: Request) => {
  // Try Authorization header first, then ?token= query param
  const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (fromHeader) return fromHeader;
  const q = (req?.query?.token as string) || null;
  return q;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: extractFromQueryOrHeader,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'doc-signature-secret',
      passReqToCallback: false,
    });
  }

  async validate(payload: any) {
    if (!payload?.sub) throw new UnauthorizedException();
    return {
      id_user: payload.sub,
      email: payload.email,
      role: payload.role,
      first_name: payload.first_name,
      last_name: payload.last_name,
    };
  }
}
