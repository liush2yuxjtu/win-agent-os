#!/usr/bin/env python3
"""toolchain-mcp 冒烟用：打印 Python 版本与当前工作目录。"""
import os
import sys

print(f"python {sys.version.split()[0]} · cwd={os.getcwd()}")
