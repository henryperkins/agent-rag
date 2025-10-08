#!/bin/bash
# Aider wrapper script - activates the Python 3.12 virtual environment and runs aider

export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - bash)"
pyenv activate aider-env-312 2>/dev/null || true
aider "$@"