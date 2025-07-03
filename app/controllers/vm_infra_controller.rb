class VmInfraController < ApplicationController
  include VmCommon # common methods for vm controllers
  include VmRemote # methods for VM remote access
  include Mixins::VmShowMixin
  include Mixins::BreadcrumbsMixin

  before_action :check_privileges
  before_action :get_session_data

  after_action :cleanup_action
  after_action :set_session_data

  def self.table_name
    @table_name ||= "vm_infra"
  end

  def index
    flash_to_session
    redirect_to(:action => 'explorer')
  end

  def persistentvolumeclaims
    @record = find_record_with_rbac(VmOrTemplate, params[:id])
    unless @record.kind_of?(ManageIQ::Providers::Kubevirt::InfraManager::Vm)
      render json: { error: "Not a KubeVirt VM" }, status: :bad_request
      return
    end

    begin
      available_pvcs = fetch_pvcs_from_cluster(@record.ext_management_system, @record.location.presence || 'default')

      render json: {
        resources: available_pvcs,
        vm_name: @record.name,
        vm_namespace: @record.location.presence || 'default'
      }
    rescue => e
      Rails.logger.error("Error fetching PVCs: #{e.message}")
      render json: { error: e.message }, status: :internal_server_error
    end
  end

  def add_volume
    @record = find_record_with_rbac(VmOrTemplate, params[:id])
    unless @record.kind_of?(ManageIQ::Providers::Kubevirt::InfraManager::Vm)
      render json: { error: "Not a KubeVirt VM" }, status: :bad_request
      return
    end

    begin
      data = JSON.parse(request.body.read)
      pvc_name = data.dig("resource", "pvc_name")
      volume_name = data.dig("resource", "volume_name") || pvc_name
      volume_size = data.dig("resource", "volume_size")

      Rails.logger.info("Attaching volume to VM: #{@record.name}")
      Rails.logger.info("PVC Name: #{pvc_name}, Volume Name: #{volume_name}")
     # custom volum size
      if pvc_name.present?
        Rails.logger.info("Attaching existing PVC '#{pvc_name}' to VM '#{@record.name}' as volume '#{volume_name}'")
        result = attach_volume_to_vm(@record, pvc_name, volume_name)
      elsif volume_name.present? && volume_size.present?
        Rails.logger.info("Creating and attaching new volume '#{volume_name}' (#{volume_size}) to VM '#{@record.name}'")
        result = create_and_attach_volume(@record, volume_name, volume_size)
      else
        Rails.logger.info("Invalid input. Either PVC name or new volume name and size must be provided.")
        render json: { error: "Invalid input. Either PVC name or new volume name and size must be provided." }, status: :bad_request
        return
      end
        # custom volum size
  

      if result[:success]
        render json: {
          success: true,
          message: "Successfully attached volume '#{volume_name}' to VM"
        }, status: :ok
      else
        render json: { success: false, error: result[:error] }, status: :unprocessable_entity
      end

    rescue => e
      Rails.logger.error("Error attaching volume: #{e.message}")
      Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
      render json: { success: false, error: e.message }, status: :internal_server_error
    end
  end

  def remove_volume
    @record = find_record_with_rbac(VmOrTemplate, params[:id])
    unless @record.kind_of?(ManageIQ::Providers::Kubevirt::InfraManager::Vm)
      render json: { error: "Not a KubeVirt VM" }, status: :bad_request
      return
    end

    begin
      data = JSON.parse(request.body.read)
      volume_name = data.dig("resource", "volume_name")

      if volume_name.blank?
        render json: { error: "Volume name is required" }, status: :bad_request
        return
      end

      result = remove_volume_from_vm(@record, volume_name)

      if result[:success]
        render json: {
          success: true,
          message: "Successfully detached volume '#{volume_name}' from VM"
        }, status: :ok
      else
        render json: { success: false, error: result[:error] }, status: :unprocessable_entity
      end

    rescue => e
      Rails.logger.error("Error detaching volume: #{e.message}")
      Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
      render json: { success: false, error: e.message }, status: :internal_server_error
    end
  end

  def attached_volumes
    @record = find_record_with_rbac(VmOrTemplate, params[:id])

    unless @record.kind_of?(ManageIQ::Providers::Kubevirt::InfraManager::Vm)
      render json: { error: "Not a KubeVirt VM" }, status: :bad_request
      return
    end

    begin
      Rails.logger.info("Fetching attached volumes for VM: #{@record.name}")

      volumes = fetch_attached_volumes(@record)

      Rails.logger.info("Found #{volumes.size} volume(s) attached to VM '#{@record.name}'")

      render json: { resources: volumes }, status: :ok

    rescue => e
      Rails.logger.error("Error fetching attached volumes: #{e.message}")
      Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
      render json: { error: e.message }, status: :internal_server_error
    end
  end

  private

  def fetch_attached_volumes(vm_record)
    require 'net/http'
    require 'openssl'
    require 'json'

    provider  = vm_record.ext_management_system
    host      = provider.hostname
    port      = provider.port || 6443
    token     = provider.authentication_token
    namespace = vm_record.location.presence || 'default'
    vm_name   = vm_record.name

    raise "No authentication token available" if token.blank?

    uri = URI("https://#{host}:#{port}/apis/kubevirt.io/v1/namespaces/#{namespace}/virtualmachines/#{vm_name}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.verify_mode = OpenSSL::SSL::VERIFY_NONE

    request = Net::HTTP::Get.new(uri)
    request['Authorization'] = "Bearer #{token}"
    request['Accept'] = 'application/json'

    response = http.request(request)

    unless response.code.to_i == 200
      raise "Failed to get VM info: #{response.code} - #{response.body}"
    end

    vm_data = JSON.parse(response.body)

    # Extract attached volumes from the VM spec
    volumes = vm_data.dig("spec", "template", "spec", "volumes") || []

    # Return volumes as array of { metadata: { name: <volume-name> } }
    # volumes.map do |vol|
    #   name = vol["name"]
    #   { metadata: { name: name } }
    # end
    # claim_names = volumes.map do |volume|
    #   name = volume.dig("persistentVolumeClaim", "claimName")
    # end.compact

    # claim_names.map do |n|
    #   { metadata: {name:n} }
    # end

    attached = volumes.map do |volume|
      pvc_name = volume.dig("persistentVolumeClaim", "claimName")
      dv_name  = volume.dig("dataVolume", "name")

      name = pvc_name || dv_name
      next if name.nil?

      { metadata: { name: name } }
    end.compact

    attached

  end


  def remove_volume_from_vm(vm_record, volume_name)
    require 'net/http'
    require 'openssl'
    require 'json'

    begin
      provider  = vm_record.ext_management_system
      host      = provider.hostname
      port      = provider.port || 6443
      token     = provider.authentication_token
      namespace = vm_record.location.presence || 'default'
      vm_name   = vm_record.name

      return { success: false, error: "No authentication token available" } if token.blank?

      body = { "name" => volume_name }

      uri = URI("https://#{host}:#{port}/apis/subresources.kubevirt.io/v1/namespaces/#{namespace}/virtualmachines/#{vm_name}/removevolume")

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.verify_mode = OpenSSL::SSL::VERIFY_NONE

      request = Net::HTTP::Put.new(uri)
      request['Authorization'] = "Bearer #{token}"
      request['Content-Type'] = 'application/json'
      request['Accept'] = '*/*'
      request.body = body.to_json

      response = http.request(request)

      Rails.logger.info("Remove volume response: #{response.code} - #{response.body}")

      if response.code == "200" || response.code == "202"
        return { success: true }
      else
        return { success: false, error: "Failed to remove volume: #{response.code} - #{response.body}" }
      end

    rescue => e
      Rails.logger.error("Exception in remove_volume_from_vm: #{e.message}")
      Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
      return { success: false, error: e.message }
    end
  end

# custom volum size
  def create_and_attach_volume(vm_record, volume_name, volume_size)
    require 'net/http'
    require 'openssl'
    require 'json'

    provider = vm_record.ext_management_system
    host = provider.hostname
    port = provider.port || 6443
    token = provider.authentication_token
    namespace = vm_record.location.presence || 'default'
    vm_name = vm_record.name

    return { success: false, error: "No authentication token available" } if token.blank?

    volume_name = volume_name.to_s.downcase.strip
    unless volume_name =~ /\A[a-z](?:[a-z0-9-]*[a-z0-9])\z/
      return { success: false, error: "Invalid volume name '#{volume_name}'. Must match RFC1123 DNS label format." }
    end

    # ✅ Step 1: Create PersistentVolumeClaim
    pvc_body = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: volume_name,
        namespace: namespace
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: volume_size
          }
        },
        storageClassName: "lvms-vg1"
      }
    }

    pvc_uri = URI("https://#{host}:#{port}/api/v1/namespaces/#{namespace}/persistentvolumeclaims")

    http = Net::HTTP.new(pvc_uri.host, pvc_uri.port)
    http.use_ssl = true
    http.verify_mode = OpenSSL::SSL::VERIFY_NONE

    request = Net::HTTP::Post.new(pvc_uri)
    request['Authorization'] = "Bearer #{token}"
    request['Content-Type'] = 'application/json'
    request['Accept'] = '*/*'
    request.body = pvc_body.to_json

    Rails.logger.info("Creating new PVC '#{volume_name}' with size '#{volume_size}'")
    response = http.request(request)

    if response.code.to_i.between?(200, 299)
      Rails.logger.info("✅ PVC '#{volume_name}' created successfully.")
      sleep 3 # Optional wait for PVC binding
      attach_volume_to_vm(vm_record, volume_name, volume_name)
    else
      error_msg = "Failed to create PVC: #{response.code} - #{response.body}"
      Rails.logger.error(error_msg)
      { success: false, error: error_msg }
    end
  rescue => e
    Rails.logger.error("Exception in create_and_attach_volume: #{e.message}")
    Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
    { success: false, error: e.message }
  end



  def attach_volume_to_vm(vm_record, pvc_name, volume_name)
    require 'net/http'
    require 'openssl'
    require 'json'

    begin
      provider = vm_record.ext_management_system
      host = provider.hostname
      port = provider.port || 6443
      token = provider.authentication_token
      namespace = vm_record.location.presence || 'default'
      vm_name = vm_record.name

      return { success: false, error: "No authentication token available" } if token.blank?

      volume_name = volume_name.to_s.downcase.strip

      unless volume_name =~ /\A[a-z](?:[a-z0-9-]*[a-z0-9])\z/
        return { success: false, error: "Invalid volume name '#{volume_name}'. Must match RFC1123 DNS label format." }
      end

      # Matches the JSON body in the curl request
      addvolume_body = {
        "name" => pvc_name,
        "disk" => {
          "disk" => {
            "bus" => "scsi"
          }
        },
        "volumeSource" => {
          "persistentVolumeClaim" => {
            "claimName" => pvc_name
          }
        }
      }

      Rails.logger.info("AddVolume payload: #{addvolume_body.to_json}")

      # ✅ Note the updated v1alpha3 in the endpoint
      uri = URI("https://#{host}:#{port}/apis/subresources.kubevirt.io/v1alpha3/namespaces/#{namespace}/virtualmachines/#{vm_name}/addvolume")

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.verify_mode = OpenSSL::SSL::VERIFY_NONE

      request = Net::HTTP::Put.new(uri)
      request['Authorization'] = "Bearer #{token}"
      request['Content-Type'] = 'application/json'
      request['Accept'] = '*/*'
      request.body = addvolume_body.to_json

      response = http.request(request)

      Rails.logger.info("AddVolume response: #{response.code} - #{response.message}")

      if response.code.to_i.between?(200, 299)
        Rails.logger.info("✅ Volume '#{volume_name}' successfully attached to VM '#{vm_name}'")
        { success: true }
      else
        begin
          error_json = JSON.parse(response.body)
          error_message = error_json["message"] || "Unknown error"
        rescue JSON::ParserError
          error_message = response.body
        end
        Rails.logger.error(error_message)
        { success: false, error: error_message }
      end

    rescue => e
      Rails.logger.error("⚠️ Exception in attach_volume_to_vm: #{e.message}")
      Rails.logger.error("Backtrace: #{e.backtrace.join("\n")}")
      { success: false, error: "❌ Exception occurred: #{e.message}", exception: true }
    end
  end



  def fetch_pvcs_from_cluster(ems, namespace)
    key = ems.authentication_token
  
    cdi_client = Kubeclient::Client.new(
      "https://192.168.10.94:6443/apis/cdi.kubevirt.io",
      'v1beta1',
      ssl_options: { verify_ssl: OpenSSL::SSL::VERIFY_NONE },
      auth_options: { bearer_token: key }
    )
    kubevirt_client = Kubeclient::Client.new(
      "https://192.168.10.94:6443/apis/kubevirt.io", 'v1',
      ssl_options: { verify_ssl: OpenSSL::SSL::VERIFY_NONE },
      auth_options: { bearer_token: key }
    )

    kubevirt_client.discover
    cdi_client.discover

    # Step 1: Get all DataVolumes
    data_volumes = cdi_client.get_data_volumes(namespace: namespace)

    # Step 2: Get all VMs in the namespace
    vms = kubevirt_client.get_virtual_machines(namespace: namespace)

    # Step 3: Collect all PVCs attached to any VM
    attached_pvc_names = vms.flat_map do |vm|
      next [] unless vm&.spec&.template&.spec&.volumes
      vm.spec.template.spec.volumes.map do |vol|
        vol&.persistentVolumeClaim&.claimName
      end.compact
    end.to_set

    # Step 4: Filter DataVolumes whose underlying PVC is not attached
    detached_pvcs = data_volumes.reject do |dv|
      attached_pvc_names.include?(dv.metadata.name)
    end

    # Step 5: Return names of detached PVCs
    detached_pvcs.map { |pvc| { metadata: { name: pvc.metadata.name } } }

  end

  def features
    [
      {
        :role  => "vandt_accord",
        :name  => :vandt,
        :title => _("VMs & Templates")
      },
      {
        :role  => "vms_filter_accord",
        :name  => :vms_filter,
        :title => _("VMs")
      },
      {
        :role  => "templates_filter_accord",
        :name  => :templates_filter,
        :title => _("Templates")
      },
    ].map { |hsh| ApplicationController::Feature.new_with_hash(hsh) }
  end

  def prefix_by_nodetype(nodetype)
    case TreeBuilder.get_model_for_prefix(nodetype).underscore
    when "miq_template" then "templates"
    when "vm"           then "vms"
    end
  end

  def set_elements_and_redirect_unauthorized_user
    @nodetype, _id = parse_nodetype_and_id(params[:id])
    prefix = prefix_by_nodetype(@nodetype)

    # Position in tree that matches selected record
    if role_allows?(:feature => "vandt_accord")
      set_active_elements_authorized_user('vandt_tree', 'vandt')
    elsif role_allows?(:feature => "#{prefix}_filter_accord")
      set_active_elements_authorized_user("#{prefix}_filter_tree", "#{prefix}_filter")
    else
      if (prefix == "vms" && role_allows?(:feature => "vms_instances_filter_accord")) ||
         (prefix == "templates" && role_allows?(:feature => "templates_images_filter_accord"))
        redirect_to(:controller => 'vm_or_template', :action => "explorer", :id => params[:id])
      else
        redirect_to(:controller => 'dashboard', :action => "auth_error")
      end
      return true
    end

    resolve_node_info(params[:id])
  end

  def tagging_explorer_controller?
    @explorer
  end

  def skip_breadcrumb?
    breadcrumb_prohibited_for_action?
  end

  def breadcrumbs_options
    {
      :breadcrumbs    => [
        {:title => _("Compute")},
        {:title => _("Infrastructure")},
        {:title => _("Virtual Machines")},
      ],
      :include_record => true,
      :x_node         => x_node_right_cell
    }
  end

  menu_section :inf
  feature_for_actions %w[vms_filter_accord templates_filter_accord], *ADV_SEARCH_ACTIONS
  feature_for_actions 'vm_show', :groups, :users, :patches
  feature_for_actions ['vm_protect', 'miq_template_protect'], :protect
  feature_for_actions ['vm_timeline', 'miq_template_timeline'], :tl_chooser
  feature_for_actions ['vm_perf', 'miq_template_perf'], :perf_top_chart
  has_custom_buttons
end
