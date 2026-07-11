#!/usr/bin/env python3
"""
Stitch Studio Launcher
Run this file to start the application:
    python run_stitch_studio.py
"""
import sys
import os

# Add the app directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stitch_studio.__main__ import main

if __name__ == "__main__":
    main()
