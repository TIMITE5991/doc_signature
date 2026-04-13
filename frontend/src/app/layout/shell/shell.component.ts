import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { HeaderComponent } from '../header/header.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterOutlet, SidebarComponent, HeaderComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <div class="shell-main">
        <app-header />
        <main class="shell-content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    .shell { display: flex; height: 100vh; overflow: hidden; }
    .shell-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .shell-content { flex: 1; overflow-y: auto; padding: 28px 32px; background: var(--bg); }
  `],
})
export class ShellComponent {}
