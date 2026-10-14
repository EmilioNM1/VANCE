export class AiUnavailableError extends Error {
  constructor(
    message = "El servicio de IA no está disponible en este momento.",
    public retryable = true,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiNotConfiguredError extends AiUnavailableError {
  constructor() {
    super("La IA no está configurada (falta ANTHROPIC_API_KEY). Esta función requiere un proveedor de IA.", false);
    this.name = "AiNotConfiguredError";
  }
}

export class AiBudgetExceededError extends Error {
  constructor() {
    super("Has alcanzado el límite diario de uso de IA. Podrás continuar mañana o ampliar el límite en la configuración del servidor.");
    this.name = "AiBudgetExceededError";
  }
}

export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}
