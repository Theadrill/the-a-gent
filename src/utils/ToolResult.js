class ToolResult {
  constructor(success, data = null, error = null, metadata = {}) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data,
      error: this.error,
      metadata: this.metadata
    };
  }

  static ok(data, metadata = {}) {
    return new ToolResult(true, data, null, metadata);
  }

  static fail(error, metadata = {}) {
    return new ToolResult(false, null, error, metadata);
  }
}

module.exports = { ToolResult };
