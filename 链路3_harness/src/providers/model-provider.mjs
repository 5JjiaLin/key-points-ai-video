export class ModelProvider {
  async complete(_request) {
    throw new Error('ModelProvider.complete must be implemented')
  }
}
