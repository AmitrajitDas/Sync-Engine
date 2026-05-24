// OpenTelemetry tracing bootstrap.
// Activated by setting OTEL_EXPORTER_OTLP_ENDPOINT env var.
//
// To enable, install:
//   npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
//               @opentelemetry/exporter-trace-otlp-http
// Then uncomment the SDK block below and remove the dynamic import guard.
//
// Span attributes emitted per request: tenant.id, user.id, bucket, collection, client.id.

export interface TracingOptions {
  serviceName: string;
  exporterEndpoint?: string;
}

export function setupTracing(opts: TracingOptions): void {
  if (!opts.exporterEndpoint) return;

  // Dynamic import at runtime — packages optional. Install to activate:
  //   npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  //               @opentelemetry/exporter-trace-otlp-http
  const endpoint = opts.exporterEndpoint;
  void Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    import("@opentelemetry/sdk-node" as string) as Promise<{ NodeSDK: new (o: unknown) => { start(): void } }>,
    import("@opentelemetry/exporter-trace-otlp-http" as string) as Promise<{ OTLPTraceExporter: new (o: unknown) => unknown }>,
    import("@opentelemetry/auto-instrumentations-node" as string) as Promise<{ getNodeAutoInstrumentations: () => unknown[] }>,
  ]).then(([{ NodeSDK }, { OTLPTraceExporter }, { getNodeAutoInstrumentations }]) => {
    const sdk = new NodeSDK({
      serviceName: opts.serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
  }).catch(() => {
    // OTel packages not installed — tracing disabled, request path unaffected.
  });
}
