import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'ds_token';
  private readonly USER_KEY  = 'ds_user';

  private tokenSubject  = new BehaviorSubject<string | null>(this.loadToken());
  private userSubject   = new BehaviorSubject<User | null>(this.loadUser());

  token$:   Observable<string | null> = this.tokenSubject.asObservable();
  user$:    Observable<User | null>   = this.userSubject.asObservable();

  get token(): string | null  { return this.tokenSubject.value; }
  get user():  User | null    { return this.userSubject.value; }
  get isLoggedIn(): boolean   { return !!this.tokenSubject.value; }

  setAuth(token: string, user: User): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY,  JSON.stringify(user));
    this.tokenSubject.next(token);
    this.userSubject.next(user);
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.tokenSubject.next(null);
    this.userSubject.next(null);
  }

  hasRole(...roles: string[]): boolean {
    return !!this.user && roles.includes(this.user.role);
  }

  updateUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.userSubject.next(user);
  }

  private loadToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  private loadUser(): User | null {
    const raw = localStorage.getItem(this.USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
}
