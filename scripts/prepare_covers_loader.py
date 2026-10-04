"""Import the existing public cover allocator without executing its CLI."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("pliego_prepare_covers", Path(__file__).with_name("prepare-covers.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
