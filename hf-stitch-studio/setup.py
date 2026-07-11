from setuptools import setup, find_packages

setup(
    name="stitch-studio",
    version="1.0.0",
    description="Image to Embroidery Pattern Converter with Vector Preview",
    author="StitchStudio",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "PySide6>=6.6.0",
        "pyembroidery>=1.5.0",
        "numpy>=1.24.0",
        "scipy>=1.10.0",
        "scikit-image>=0.21.0",
        "scikit-learn>=1.3.0",
        "opencv-python>=4.8.0",
        "Pillow>=10.0.0",
        "shapely>=2.0.0",
    ],
    entry_points={
        "console_scripts": [
            "stitch-studio=stitch_studio.__main__:main",
        ],
    },
)
