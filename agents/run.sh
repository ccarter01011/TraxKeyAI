#!/bin/bash
set -e
pip install --no-cache-dir -r requirements.txt
exec python worker.py
