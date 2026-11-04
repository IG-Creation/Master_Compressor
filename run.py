#!/usr/bin/env python3
"""
Master Compressor - Universal Data Compression & Database Storage Engine
Unified launcher script.
"""

import sys
import unittest

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        print("Running full Master Compressor test suite...")
        loader = unittest.TestLoader()
        tests = loader.discover("tests")
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(tests)
        sys.exit(0 if result.wasSuccessful() else 1)

    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        from master_compressor.server import start_server
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
        start_server(port)
        return

    if len(sys.argv) > 1 and sys.argv[1] == "--bench":
        from master_compressor.cli import run_benchmark
        size_kb = int(sys.argv[2]) if len(sys.argv) > 2 else 100
        run_benchmark(size_kb)
        return

    from master_compressor.cli import main as cli_main
    sys.exit(cli_main())

if __name__ == "__main__":
    main()
