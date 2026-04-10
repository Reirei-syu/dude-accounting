export interface ValidationResultLike {
  success: boolean
  valid?: boolean
  actualChecksum?: string | null
  error?: string
}

export interface ValidationFeedback {
  shouldReload: boolean
  message: {
    type: 'success' | 'error'
    text: string
  }
}

function wasValidationExecuted(result: ValidationResultLike): boolean {
  return (
    typeof result.valid === 'boolean' ||
    Object.prototype.hasOwnProperty.call(result, 'actualChecksum')
  )
}

export function buildValidationFeedback(
  result: ValidationResultLike,
  successText: string,
  failureText: string
): ValidationFeedback {
  if (result.success) {
    return {
      shouldReload: true,
      message: {
        type: 'success',
        text: successText
      }
    }
  }

  if (wasValidationExecuted(result)) {
    return {
      shouldReload: true,
      message: {
        type: 'error',
        text: result.error || failureText
      }
    }
  }

  return {
    shouldReload: false,
    message: {
      type: 'error',
      text: result.error || failureText
    }
  }
}
