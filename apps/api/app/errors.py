class AppError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 422,
                 retryable: bool = False, field_path: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retryable = retryable
        self.field_path = field_path

    def public(self):
        result = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.field_path:
            result["fieldPath"] = self.field_path
        return result


def public_error(exc):
    if isinstance(exc, AppError):
        return exc.public()
    if hasattr(exc, "code") and hasattr(exc, "http_status"):
        return {"code": exc.code, "message": str(exc),
                "retryable": getattr(exc, "retryable", False)}
    return {"code": "INTERNAL_ERROR", "message": "服务执行失败，请使用 trace_id 排查。", "retryable": False}
