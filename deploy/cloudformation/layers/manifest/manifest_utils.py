import boto3
import json


def s3_read_file_content(bucket, key):
    """
    Retrieve S3 file content

    Args:
        bucket: S3 bucket where file is located
        key: file to read
    """
    content_object = boto3.resource('s3').Object(bucket, key)
    return content_object.get()['Body'].read().decode('utf-8')


def s3_write_json(bucket, key, json_hash):
    """
    Creates S3 json file

    Args:
        bucket: S3 bucket where file is located
        key: file to read
        json: json content
    """
    s3 = boto3.resource('s3')
    s3.Object(bucket, key).put(Body=json.dumps(json_hash), ContentType='text/json')


def s3_copy_data(dest_bucket, dest_key, src_bucket, src_key, **kwargs):
    """
    Copies S3 data from one key to another

    Args:
        dest_bucket: S3 bucket to copy data to
        dest_key: destination data location
        src_bucket: S3 bucket to copy data from
        src_key: source data location
    """
    s3 = boto3.resource('s3')
    dest_bucket = s3.Bucket(dest_bucket)
    from_source = {
        'Bucket': src_bucket,
        'Key': src_key
    }
    extra = kwargs.get('extra', {})
    dest_bucket.copy(from_source, dest_key, ExtraArgs=extra)


def s3_list_obj_by_path(bucket, s3_path):
    """
    List S3 objects in a specified path

    Args:
        bucket: S3 bucket
        path: path to list objects from
    """
    s3 = boto3.client('s3')
    params = {
        'Bucket': bucket,
        'Prefix': s3_path,
        'StartAfter': s3_path,
    }
    attempt = 0
    keys = []
    while ('ContinuationToken' in params) or (attempt == 0):
        attempt += 1
        objects = s3.list_objects_v2(**params)
        for content in objects['Contents']:
            # skip 'folders'
            if content['Key'].endswith('/'):
                continue
            keys.append(content['Key'])
        # grab more objects to process if necessary(max 1,000/request)
        if objects['IsTruncated']:
            params['ContinuationToken'] = objects['NextContinuationToken']
        else:
            params.pop('ContinuationToken', None)
    return keys


def ssm_get_params_by_path(ssm_path):
    """
    Retrieve SSM parameters by path

    Args:
        ssm_path: path where parameters are stored
    """
    client = boto3.client('ssm')
    paginator = client.get_paginator('get_parameters_by_path')
    ssm_path += '/'
    page_iterator = paginator.paginate(
        Path=ssm_path,
        Recursive=True,
        WithDecryption=True)

    response = []
    for page in page_iterator:
        response.extend(page['Parameters'])
    return response
