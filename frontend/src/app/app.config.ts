import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withNavigationErrorHandler((error) => {
        if (error?.message?.includes('Failed to fetch dynamically imported module') ||
            error?.message?.includes('Loading chunk')) {
          window.location.reload();
        }
      }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
  ],
};
