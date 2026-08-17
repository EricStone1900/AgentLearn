export class HelloAgentsError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HelloAgentsError";
  }
}

export class LlmConfigError extends HelloAgentsError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmConfigError";
  }
}

export class LlmInvocationError extends HelloAgentsError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmInvocationError";
  }
}

export class ConfigError extends HelloAgentsError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}
