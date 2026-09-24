import { Logger, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment';
import { AllExceptionsFilter } from './shared/infrastructure/http/all-exceptions.filter';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));
  const environment = app.get<Environment>(ENVIRONMENT);

  // Security headers. `contentSecurityPolicy` is disabled because this process
  // serves JSON only: the SPA is delivered by CloudFront, which applies its own
  // policy. A CSP on an API response protects nothing and misleads reviewers.
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }),
  );
  app.use(compression());

  const allowedOrigins = environment.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // Empty list means same-origin only, which is the deployed arrangement: one
  // CloudFront distribution fronts both the SPA and this API, so the browser
  // never issues a cross-origin request and CORS stops being a concern.
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  // Probes are excluded from the prefix and from versioning: load balancers and
  // container orchestrators are configured with a fixed path, and they must not
  // have to be reconfigured when the API is versioned.
  // Tells Express how many proxy hops to trust when deriving req.ip, which is
  // what the rate limiter counts by.
  //
  // Both directions of error are serious. Trust too few hops and every request
  // appears to come from the proxy, so all callers share one bucket and a
  // single client can lock out everyone. Trust too many and a caller can forge
  // X-Forwarded-For to present a different address on each request, evading the
  // limiter completely. Express discards exactly this many entries from the
  // right of the header; everything to the left of that line is
  // attacker-controlled.
  //
  // 0 for a direct connection. Behind CloudFront and nginx it is 2: CloudFront
  // records the client address, nginx appends CloudFront's.
  if (environment.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', environment.TRUST_PROXY_HOPS);
  }

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips properties with no matching decorator. This is what stops mass
      // assignment: a client adding "role" or "amount" to a payload has those
      // fields removed before any logic can read them.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Lets Nest run onModuleDestroy hooks on SIGTERM, so in-flight requests finish
  // and connections close before the process exits. Without this, a deploy drops
  // whatever was being served at that moment.
  app.enableShutdownHooks();

  if (environment.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ADH Shop API')
        .setDescription('Checkout API for the ADH Shop storefront')
        .setVersion('1.0')
        .build(),
    );

    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(environment.PORT, '0.0.0.0');

  new Logger('Bootstrap').log(
    `Listening on port ${environment.PORT} in ${environment.NODE_ENV} mode`,
  );
};

void bootstrap();
