import {load as grpcDef} from '@grpc/proto-loader';
import * as fs from 'fs';
import {GrpcObject, loadPackageDefinition} from 'grpc';
import get = require('lodash/get');
import * as path from 'path';
import {Namespace, Root, Service, Service as ProtoService} from 'protobufjs';

export interface Proto {
  fileName: string;
  filePath: string;
  protoText: string;
  ast: GrpcObject;
  root: Root;
}

/**
 * Proto ast from filename
 */
export async function fromFileName(protoPath: string): Promise<Proto> {
  const packageDefinition = await grpcDef(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });

  const protoAST = loadPackageDefinition(packageDefinition);

  const root = await new Root().load(
    protoPath,
    {
      keepCase: true,
    }
  );

  const protoText = await promisifyRead(protoPath);

  return {
    fileName: protoPath.split(path.sep).pop() || '',
    filePath: protoPath,
    protoText,
    ast: protoAST,
    root,
  };
}

/**
 * Walk through services
 */
export function walkServices(proto: Proto, onService: (service: Service, def: any, serviceName: string) => void) {
  const {ast, root} = proto;

  Object.keys(ast)
    .forEach(serviceName => {
      const lookupType = root.lookup(serviceName);
      if (lookupType && lookupType.constructor.name === 'Namespace') {
        walkNamespace(root, namespace => {
          const nestedNamespaceTypes = namespace.nested;
          if (nestedNamespaceTypes) {
            Object.keys(nestedNamespaceTypes).forEach(nestedTypeName => {
              const nestedType = root.lookup(nestedTypeName);
              if (nestedType instanceof Service) {
                const fullNamespaceName = (namespace.fullName.startsWith('.'))
                  ? namespace.fullName.replace('.', '')
                  : namespace.fullName;

                const serviceName = [
                  ...fullNamespaceName.split('.'),
                  nestedType.name
                ];

                onService(nestedType as Service, get(ast, serviceName), serviceName.join('.'));
              }
            });
          }
        });
      } else {
        // No namespace, root services
        onService(serviceByName(root, serviceName), ast[serviceName], serviceName);
      }
    });
}

export function walkNamespace(root: Root, onNamespace: (namespace: Namespace) => void, parentNamespace?: Namespace) {
  const nestedType = (parentNamespace && parentNamespace.nested) || root.nested;

  if (nestedType) {
    Object.keys(nestedType).forEach((typeName: string) => {
      const nestedNamespace = root.lookup(typeName);
      if (nestedNamespace && nestedNamespace.constructor.name === 'Namespace') {
        onNamespace(nestedNamespace as Namespace);
        walkNamespace(root, onNamespace, nestedNamespace as Namespace);
      }
    });
  }
}

export function serviceByName(root: Root, serviceName: string): ProtoService {
  if (!root.nested) {
    throw new Error('Empty PROTO!');
  }

  const serviceLeaf = root.nested[serviceName];
  return root.lookupService(serviceLeaf.fullName);
}

function promisifyRead(fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(fileName, 'utf8', function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
