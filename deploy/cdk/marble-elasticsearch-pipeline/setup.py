import setuptools


with open("README.md") as fp:
    long_description = fp.read()


setuptools.setup(
    name="marble_elasticsearch_pipeline",
    version="0.0.1",

    description="An empty CDK Python app",
    long_description=long_description,
    long_description_content_type="text/markdown",

    author="author",

    package_dir={"": "marble_elasticsearch_pipeline"},
    packages=setuptools.find_packages(where="marble_elasticsearch_pipeline"),

    install_requires=[
        "aws-cdk.core>=1.7.0,<2.0",
        "aws-cdk.aws_iam>=1.7.0,<2.0",
        "aws_cdk.aws_ssm>=1.7.0,<2.0",
        "aws_cdk.aws_codebuild>=1.7.0,<2.0",
        "aws_cdk.aws_codepipeline>=1.7.0,<2.0",
        "aws_cdk.aws_codepipeline_actions>=1.7.0,<2.0",
    ],

    python_requires=">=3.6",

    classifiers=[
        "Development Status :: 4 - Beta",

        "Intended Audience :: Developers",

        "License :: OSI Approved :: Apache Software License",

        "Programming Language :: JavaScript",
        "Programming Language :: Python :: 3 :: Only",
        "Programming Language :: Python :: 3.6",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",

        "Topic :: Software Development :: Code Generators",
        "Topic :: Utilities",

        "Typing :: Typed",
    ],
)
