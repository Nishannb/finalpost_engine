import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from '@aws-sdk/client-iam';
import dotenv from 'dotenv';

dotenv.config({path: new URL('../.env', import.meta.url).pathname});

const roleName = 'remotion-lambda-role';
const client = new IAMClient({
  region: process.env.REMOTION_AWS_REGION || 'us-east-1',
});

const trustPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: {Service: 'lambda.amazonaws.com'},
      Action: 'sts:AssumeRole',
    },
  ],
};

const rolePolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['s3:ListAllMyBuckets'],
      Resource: ['*'],
    },
    {
      Effect: 'Allow',
      Action: [
        's3:CreateBucket',
        's3:ListBucket',
        's3:PutBucketAcl',
        's3:GetObject',
        's3:DeleteObject',
        's3:PutObjectAcl',
        's3:PutObject',
        's3:GetBucketLocation',
      ],
      Resource: ['arn:aws:s3:::remotionlambda-*'],
    },
    {
      Effect: 'Allow',
      Action: ['lambda:InvokeFunction'],
      Resource: ['arn:aws:lambda:*:*:function:remotion-render-*'],
    },
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogGroup'],
      Resource: ['arn:aws:logs:*:*:log-group:/aws/lambda-insights'],
    },
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: [
        'arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*',
        'arn:aws:logs:*:*:log-group:/aws/lambda-insights:*',
      ],
    },
  ],
};

try {
  await client.send(new GetRoleCommand({RoleName: roleName}));
  console.log(`${roleName} already exists`);
} catch (error) {
  if (error?.name !== 'NoSuchEntityException') {
    throw error;
  }
  await client.send(
    new CreateRoleCommand({
      RoleName: roleName,
      Description: 'Execution role for Remotion video rendering',
      AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
    }),
  );
  console.log(`created ${roleName}`);
}

await client.send(
  new PutRolePolicyCommand({
    RoleName: roleName,
    PolicyName: 'remotion-lambda-policy',
    PolicyDocument: JSON.stringify(rolePolicy),
  }),
);
console.log('attached Remotion role policy');
