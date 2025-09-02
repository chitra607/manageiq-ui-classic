import { componentTypes, validatorTypes } from '@@ddf';

// Load container managers
const providerUrl = '/api/providers?expand=resources&attributes=id,name,type&filter[]=type=ManageIQ::Providers::Openshift::ContainerManager';

const loadProviders = () =>
  API.get(providerUrl)
    .then(({ resources }) => resources.map(({ id, name }) => ({ label: name, value: id })))
    .catch((error) => {
      console.error('Error loading providers:', error);
      return [];
    });

// Default node YAML template
const defaultNodeYaml = `apiVersion: v1
kind: Node
metadata:
  name: my-node
  labels:
    kubernetes.io/hostname: my-node
    kubernetes.io/os: linux
    kubernetes.io/arch: amd64
    node-role.kubernetes.io/worker: ""
spec:
  podCIDR: 10.244.1.0/24
  podCIDRs:
  - 10.244.1.0/24
status:
  capacity:
    cpu: "4"
    memory: 8Gi
    pods: "110"
  allocatable:
    cpu: "4"
    memory: 7Gi
    pods: "110"
  addresses:
  - type: InternalIP
    address: 192.168.1.100
  - type: Hostname
    address: my-node
  nodeInfo:
    machineID: "abc123def456"
    systemUUID: "xyz789"
    bootID: "boot123"
    kernelVersion: "5.4.0-42-generic"
    osImage: "Ubuntu 20.04.1 LTS"
    containerRuntimeVersion: "containerd://1.4.3"
    kubeletVersion: "v1.21.0"
    kubeProxyVersion: "v1.21.0"
    operatingSystem: "linux"
    architecture: "amd64"`;

const createSchema = (emsId, setState, mode = 'create') => {
  console.log('Creating schema with mode:', mode, 'emsId:', emsId);
  
  if (mode === 'edit') {
    return {
      fields: [
        {
          component: componentTypes.TEXT_FIELD,
          id: 'node_name',
          name: 'node_name',
          label: __('Node Name'),
          isDisabled: true,
        },
        {
          component: componentTypes.TEXT_FIELD,
          id: 'container_provider',
          name: 'container_provider',
          label: __('Container Provider'),
          isDisabled: true,
        },
        {
          component: componentTypes.TEXT_FIELD,
          id: 'hostname',
          name: 'hostname',
          label: __('Hostname'),
          isDisabled: true,
        },
        // Node Details section
        {
          component: componentTypes.SUB_FORM,
          id: 'node_details',
          name: 'node_details',
          title: __('Node Details'),
          fields: [
            {
              component: componentTypes.TEXT_FIELD,
              id: 'container_runtime_version',
              name: 'container_runtime_version',
              label: __('Container Runtime Version'),
              isDisabled: true,
            },
            {
              component: componentTypes.TEXT_FIELD,
              id: 'kubernetes_version',
              name: 'kubernetes_version',
              label: __('Kubernetes Version'),
              isDisabled: true,
            },
            {
              component: componentTypes.TEXT_FIELD,
              id: 'operating_system',
              name: 'operating_system',
              label: __('Operating System'),
              isDisabled: true,
            },
            {
              component: componentTypes.TEXT_FIELD,
              id: 'kernel_version',
              name: 'kernel_version',
              label: __('Kernel Version'),
              isDisabled: true,
            },
          ],
        },
        // Node Status & Configuration section - SIMPLIFIED
        {
          component: componentTypes.SUB_FORM,
          id: 'node_status',
          name: 'node_status',
          title: __('Node Status & Configuration'),
          fields: [
            {
              component: componentTypes.SWITCH,
              id: 'schedulable',
              name: 'schedulable',
              label: __('Schedulable'),
              helperText: __('Whether the node can accept new pods'),
            },
            {
              component: componentTypes.TEXT_FIELD,
              id: 'max_container_groups',
              name: 'max_container_groups',
              label: __('Maximum Container Groups'),
              type: 'number',
              helperText: __('Maximum number of pods that can be scheduled on this node'),
              isDisabled: false,
            },
          ],
        },
        // SIMPLIFIED Labels section - NO VALIDATION
        {
          component: componentTypes.SUB_FORM,
          id: 'labels_section',
          name: 'labels_section',
          title: __('Labels'),
          fields: [
            {
              component: componentTypes.FIELD_ARRAY,
              id: 'labels',
              name: 'labels',
              fields: [
                {
                  component: componentTypes.TEXT_FIELD,
                  id: 'key',
                  name: 'key',
                  label: __('Key'),
                  validate: [{ type: validatorTypes.REQUIRED }],
                  isRequired: true,
                },
                {
                  component: componentTypes.TEXT_FIELD,
                  id: 'value',
                  name: 'value',
                  label: __('Value'),
                },
              ],
              buttonLabels: {
                add: __('Add Label'),
                remove: __('Remove'),
              },
            },
          ],
        },
        // SIMPLIFIED Annotations section - NO VALIDATION
        {
          component: componentTypes.SUB_FORM,
          id: 'annotations_section',
          name: 'annotations_section',
          title: __('Annotations'),
          fields: [
            {
              component: componentTypes.FIELD_ARRAY,
              id: 'annotations',
              name: 'annotations',
              fields: [
                {
                  component: componentTypes.TEXT_FIELD,
                  id: 'key',
                  name: 'key',
                  label: __('Key'),
                  validate: [{ type: validatorTypes.REQUIRED }],
                  isRequired: true,
                },
                {
                  component: componentTypes.TEXT_FIELD,
                  id: 'value',
                  name: 'value',
                  label: __('Value'),
                },
              ],
              buttonLabels: {
                add: __('Add Annotation'),
                remove: __('Remove'),
              },
            },
          ],
        },
      ],
    };
  }

  // Create mode - YAML based
  return {
    fields: [
      {
        component: componentTypes.SELECT,
        id: 'ems_id',
        name: 'ems_id',
        label: __('Container Provider'),
        validate: [{ type: validatorTypes.REQUIRED }],
        onChange: (value) => setState((state) => ({ ...state, emsId: value })),
        isRequired: true,
        includeEmpty: true,
        loadOptions: loadProviders,
      },
      {
        component: componentTypes.TEXTAREA,
        id: 'yaml_content',
        name: 'yaml_content',
        label: __('Node Definition (YAML)'),
        validate: [
          { type: validatorTypes.REQUIRED },
          {
            type: validatorTypes.PATTERN,
            pattern: /^apiVersion:/,
            message: __('YAML must start with apiVersion'),
          },
        ],
        isRequired: true,
        rows: 25,
        className: 'yaml-editor',
        initialValue: defaultNodeYaml,
        helperText: __('Define your node using YAML format'),
        condition: {
          when: 'ems_id',
          isNotEmpty: true,
        },
      },
    ],
  };
};

export default createSchema;